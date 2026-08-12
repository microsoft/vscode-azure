/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AppServiceLogicalType, FunctionAppLogicalType, IWebAppClientProvider,
    LogicAppLogicalType, parseAzureResourceId,
    type GenericResource, type IWebAppClient,
} from '@microsoft/vscode-azure-azutils';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { SettingsAdapter, SettingsCollectionDescriptor } from '../SettingsAdapter';
import type { SettingsMap, SettingsSnapshot } from '../core/SettingsModel';

/** Stable id of the application settings collection. Appears in URIs and node keys. */
export const AppSettingsCollectionId = 'appSettings';

const supportedLogicalTypes = new Set<string>([
    FunctionAppLogicalType.toLowerCase(),
    AppServiceLogicalType.toLowerCase(),
    LogicAppLogicalType.toLowerCase(),
]);

/**
 * {@linkcode SettingsAdapter} for every `Microsoft.Web/sites` flavour -- Function App, App Service,
 * and Logic App -- exposing application settings.
 *
 * The three products share one ARM surface, so they are one adapter rather than three.
 *
 * @remarks
 * ARM has no per-key patch: `updateApplicationSettings` replaces the whole dictionary. That is why
 * {@linkcode write} sends `entries` verbatim and omitting a key deletes it.
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
            },
        ];
    }

    /** @inheritdoc */
    public async read(resource: GenericResource, collectionId: string): Promise<SettingsSnapshot> {
        const collection = this.requireCollection(resource, collectionId);
        const { client, resourceGroupName } = this.resolveClient(resource);

        const properties = (await client.webApps.listApplicationSettings(resourceGroupName, resource.name)).properties;

        return {
            entries: toAppSettingEntries(properties),
            resourceName: resource.name,
            collectionLabel: collection.label,
            // ARM permits editing application settings on all three site kinds.
            writable: true,
        };
    }

    /** @inheritdoc */
    public async write(resource: GenericResource, collectionId: string, entries: SettingsMap): Promise<void> {
        this.requireCollection(resource, collectionId);
        const { client, resourceGroupName } = this.resolveClient(resource);
        this.validateKeys(entries);

        await client.webApps.updateApplicationSettings(resourceGroupName, resource.name, {
            properties: fromAppSettingEntries(entries),
        });
    }

    /**
     * Reject invalid names before the ARM call, so the user gets a message naming the offending
     * setting rather than a bare service error.
     */
    private validateKeys(entries: SettingsMap): void {
        for (const entry of entries) {
            if (!entry.key.trim()) {
                throw new Error(this.code.l10n.t('The setting name cannot be empty.'));
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

/** Sorted so the document presents settings in a stable, predictable order. */
function toAppSettingEntries(properties: Record<string, string> | undefined): SettingsMap {
    return Object.keys(properties ?? {}).sort().map(key => ({ key, value: properties?.[key] ?? '' }));
}

function fromAppSettingEntries(entries: SettingsMap): Record<string, string> {
    return Object.fromEntries(entries.map(entry => [entry.key, entry.value]));
}
