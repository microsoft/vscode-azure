/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AppServiceLogicalType, ConnectionStringTypes, FunctionAppLogicalType, IWebAppClientProvider,
    LogicAppLogicalType, parseAzureResourceId,
    type ConnectionStringType, type ConnStringValueTypePair, type GenericResource,
    type IWebAppClient, type SettingsAdapter, type SettingsCapabilities, type SettingsCollectionDescriptor,
} from '@microsoft/vscode-azure-azutils';
import { IVsCode, type SettingsMap, type SettingsSnapshot } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';

/** Stable id of the application settings collection. Appears in URIs and node keys. */
export const AppSettingsCollectionId = 'appSettings';

/** Stable id of the connection strings collection. Appears in URIs and node keys. */
export const ConnectionStringsCollectionId = 'connectionStrings';

/** Metadata field holding a connection string's database type. */
const TypeField = 'type';

/** Default type applied to a connection string added without one. */
const DefaultConnectionStringType: ConnectionStringType = 'Custom';

const supportedLogicalTypes = new Set<string>([
    FunctionAppLogicalType.toLowerCase(),
    AppServiceLogicalType.toLowerCase(),
    LogicAppLogicalType.toLowerCase(),
]);

/**
 * Local file each product conventionally syncs application settings with.
 *
 * Function Apps and Logic Apps use the Functions host's `local.settings.json`; plain App Service
 * sites have no host file, so a `.env` is the closest convention.
 */
const localAppSettingsFile = new Map<string, string>([
    [FunctionAppLogicalType.toLowerCase(), 'local.settings.json'],
    [LogicAppLogicalType.toLowerCase(), 'local.settings.json'],
    [AppServiceLogicalType.toLowerCase(), '.env'],
]);

/**
 * {@linkcode SettingsAdapter} for every `Microsoft.Web/sites` flavour -- Function App, App Service,
 * and Logic App -- exposing both application settings and connection strings.
 *
 * The three products share one ARM surface and differ only in the local file they sync with, so
 * they are one adapter rather than three. The two collections differ more interestingly:
 * connection strings are **structured** (each value carries a database `type`), which is what
 * exercises the framework's non-plain-string path.
 *
 * @remarks
 * ARM has no per-key patch for either collection: `update*` replaces the whole dictionary. That is
 * why {@linkcode write} sends `entries` verbatim and omitting a key deletes it.
 */
@injectable()
export class WebAppSettingsAdapter implements SettingsAdapter {
    private readonly clients = new Map<string, IWebAppClient>();

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IWebAppClientProvider) private readonly createClient: IWebAppClientProvider,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: GenericResource): boolean {
        return supportedLogicalTypes.has(resource.logicalType.toLowerCase());
    }

    /** @inheritdoc */
    public getCollections(resource: GenericResource): readonly SettingsCollectionDescriptor[] {
        if (!this.canHandle(resource)) {
            return [];
        }

        return [
            {
                id: AppSettingsCollectionId,
                label: this.code.l10n.t('Application Settings'),
                structured: false,
            },
            {
                id: ConnectionStringsCollectionId,
                label: this.code.l10n.t('Connection Strings'),
                structured: true,
            },
        ];
    }

    /** @inheritdoc */
    public getCapabilities(resource: GenericResource, collectionId: string): SettingsCapabilities {
        this.requireCollection(resource, collectionId);

        const base = {
            canAdd: true,
            canDelete: true,
            canRename: true,
            canWrite: true,
            // ARM returns real values for both collections on these resource types.
            valuesReadable: true,
            validateKey: (key: string) => this.validateKey(key),
        } satisfies Partial<SettingsCapabilities>;

        if (collectionId === ConnectionStringsCollectionId) {
            return {
                ...base,
                // No local-file convention carries connection strings, so the compare / download /
                // upload commands are not offered for them.
                validateMetadata: (field, value) => this.validateConnectionStringMetadata(field, value),
            };
        }

        const fileName = localAppSettingsFile.get(resource.logicalType.toLowerCase());
        return {
            ...base,
            localFile: fileName ? { fileName } : undefined,
        };
    }

    /** @inheritdoc */
    public async read(resource: GenericResource, collectionId: string): Promise<SettingsSnapshot> {
        const collection = this.requireCollection(resource, collectionId);
        const { client, resourceGroupName } = this.resolveClient(resource);

        const entries = collectionId === ConnectionStringsCollectionId
            ? toConnectionStringEntries((await client.webApps.listConnectionStrings(resourceGroupName, resource.name)).properties)
            : toAppSettingEntries((await client.webApps.listApplicationSettings(resourceGroupName, resource.name)).properties);

        const capabilities = this.getCapabilities(resource, collectionId);

        return {
            entries,
            resourceName: resource.name,
            collectionLabel: collection.label,
            valuesReadable: capabilities.valuesReadable,
            writable: capabilities.canWrite,
            structured: collection.structured,
        };
    }

    /** @inheritdoc */
    public async write(resource: GenericResource, collectionId: string, entries: SettingsMap): Promise<void> {
        this.requireCollection(resource, collectionId);
        const { client, resourceGroupName } = this.resolveClient(resource);

        if (collectionId === ConnectionStringsCollectionId) {
            this.validateConnectionStrings(entries);
            await client.webApps.updateConnectionStrings(resourceGroupName, resource.name, {
                properties: fromConnectionStringEntries(entries),
            });
            return;
        }

        await client.webApps.updateApplicationSettings(resourceGroupName, resource.name, {
            properties: fromAppSettingEntries(entries),
        });
    }

    private validateKey(key: string): string | undefined {
        if (!key.trim()) {
            return this.code.l10n.t('The setting name cannot be empty.');
        }
        return undefined;
    }

    private validateConnectionStringMetadata(field: string, value: string): string | undefined {
        if (field !== TypeField) {
            return this.code.l10n.t('\'{0}\' is not a recognized connection string property. Only "{1}" is supported.', field, TypeField);
        }

        if (!ConnectionStringTypes.includes(value as ConnectionStringType)) {
            return this.code.l10n.t('\'{0}\' is not a valid connection string type. Expected one of: {1}.', value, ConnectionStringTypes.join(', '));
        }

        return undefined;
    }

    /**
     * Reject invalid connection string types before the ARM call, so the user gets a message naming
     * the offending setting instead of a generic 400 from the service.
     */
    private validateConnectionStrings(entries: SettingsMap): void {
        for (const entry of entries) {
            const type = entry.metadata?.[TypeField];
            if (type !== undefined) {
                const error = this.validateConnectionStringMetadata(TypeField, type);
                if (error) {
                    throw new Error(this.code.l10n.t('Connection string \'{0}\': {1}', entry.key, error));
                }
            }
        }
    }

    private requireCollection(resource: GenericResource, collectionId: string): SettingsCollectionDescriptor {
        const collection = this.getCollections(resource).find(candidate => candidate.id === collectionId);
        if (!collection) {
            throw new Error(`'${resource.logicalType}' does not expose a settings collection named '${collectionId}'`);
        }
        return collection;
    }

    private resolveClient(resource: GenericResource): { client: IWebAppClient; resourceGroupName: string } {
        const { resourceGroup: resourceGroupName } = parseAzureResourceId(resource.id);
        if (!resourceGroupName) {
            throw new Error(`Cannot extract resource group name from resource ID: ${resource.id}`);
        }

        let client = this.clients.get(resource.subscription.subscriptionId);
        if (!client) {
            client = this.createClient(resource.subscription);
            this.clients.set(resource.subscription.subscriptionId, client);
        }

        return { client, resourceGroupName };
    }
}

/** Sorted so the tree and the document present settings in a stable, predictable order. */
function toAppSettingEntries(properties: Record<string, string> | undefined): SettingsMap {
    return Object.keys(properties ?? {}).sort().map(key => ({ key, value: properties?.[key] ?? '' }));
}

function toConnectionStringEntries(properties: Record<string, ConnStringValueTypePair> | undefined): SettingsMap {
    return Object.keys(properties ?? {}).sort().map(key => ({
        key,
        value: properties?.[key]?.value ?? '',
        metadata: { [TypeField]: properties?.[key]?.type ?? DefaultConnectionStringType },
    }));
}

function fromAppSettingEntries(entries: SettingsMap): Record<string, string> {
    return Object.fromEntries(entries.map(entry => [entry.key, entry.value]));
}

function fromConnectionStringEntries(entries: SettingsMap): Record<string, ConnStringValueTypePair> {
    return Object.fromEntries(entries.map(entry => [entry.key, {
        value: entry.value,
        type: (entry.metadata?.[TypeField] ?? DefaultConnectionStringType) as ConnectionStringType,
    }]));
}
