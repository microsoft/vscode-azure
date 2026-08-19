/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    IStaticWebAppClientProvider, parseAzureResourceId,
    type IStaticWebAppClient,
} from '@microsoft/vscode-azure-azutils';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import {
    isStaticWebAppVirtualNode, StaticWebAppVirtualTypes,
    type StaticWebAppEnvironment,
} from '../../tree/resources/staticWebApps/StaticWebApp';
import type { SettingsAdapter, SettingsOwner } from '../SettingsAdapter';
import type { SettingsMap, SettingsSnapshot } from '../SettingsModel';

/**
 * {@linkcode SettingsAdapter} for a Static Web Apps **environment**.
 *
 * Unlike `Microsoft.Web/sites`, a static site has no settings of its own: every environment
 * (production plus one per open pull request) carries its own application settings, so the owner
 * here is the environment's virtual node rather than the ARM resource.
 *
 * @remarks
 * The settings surfaced are the ones ARM calls *function app settings*. Static Web Apps has only
 * this one settings dictionary -- it is what the portal and the standalone Static Web Apps
 * extension both label "Application Settings" -- and it is read by the site's managed API as well
 * as by the build. There is no second, non-Functions dictionary to disambiguate it from.
 *
 * Production reads and writes the site-level endpoints; every other environment uses the
 * build-level endpoints keyed by its build id. The two are distinct dictionaries in ARM, so
 * choosing the wrong pair would silently edit the wrong environment.
 *
 * Like every adapter, {@linkcode write} replaces the whole dictionary: ARM offers no per-key patch
 * for these settings either.
 */
@injectable()
export class StaticWebAppSettingsAdapter implements SettingsAdapter {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IStaticWebAppClientProvider) private readonly createClient: IStaticWebAppClientProvider,
    ) { }

    /** @inheritdoc */
    public get label(): string {
        return this.code.l10n.t('Application Settings');
    }

    /** @inheritdoc */
    public canHandle(owner: SettingsOwner): boolean {
        return isStaticWebAppEnvironment(owner);
    }

    /** @inheritdoc */
    public async read(owner: SettingsOwner): Promise<SettingsSnapshot> {
        const environment = this.resolveEnvironment(owner);
        const { client, resourceGroupName, siteName } = this.resolveClient(environment);

        const properties = environment.isProduction
            ? (await client.staticSites.listStaticSiteFunctionAppSettings(resourceGroupName, siteName)).properties
            : (await client.staticSites.listStaticSiteBuildFunctionAppSettings(resourceGroupName, siteName, environment.buildId)).properties;

        return {
            entries: toSettingsMap(properties),
            resourceName: `${siteName} (${environment.displayLabel})`,
            label: this.label,
            writable: true,
        };
    }

    /** @inheritdoc */
    public async write(owner: SettingsOwner, entries: SettingsMap): Promise<void> {
        const environment = this.resolveEnvironment(owner);
        const { client, resourceGroupName, siteName } = this.resolveClient(environment);
        this.validateKeys(entries);

        const properties = fromSettingsMap(entries);
        if (environment.isProduction) {
            await client.staticSites.createOrUpdateStaticSiteFunctionAppSettings(resourceGroupName, siteName, { properties });
        } else {
            await client.staticSites.createOrUpdateStaticSiteBuildFunctionAppSettings(
                resourceGroupName,
                siteName,
                environment.buildId,
                { properties },
            );
        }
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

    private resolveEnvironment(owner: SettingsOwner): StaticWebAppEnvironment {
        if (!isStaticWebAppEnvironment(owner)) {
            throw new Error('Static Web Apps application settings can only be read from an environment.');
        }

        return owner;
    }

    private resolveClient(environment: StaticWebAppEnvironment): { client: IStaticWebAppClient; resourceGroupName: string; siteName: string } {
        const site = environment.azureResource;
        const { resourceGroup: resourceGroupName } = parseAzureResourceId(site.id);
        if (!resourceGroupName) {
            throw new Error(`Cannot extract resource group name from resource ID: ${site.id}`);
        }

        return { client: this.createClient(site.subscription), resourceGroupName, siteName: site.name };
    }
}

/** Type guard narrowing a settings owner to a Static Web Apps environment node. */
function isStaticWebAppEnvironment(owner: SettingsOwner): owner is StaticWebAppEnvironment {
    return isStaticWebAppVirtualNode(owner) && owner.virtualType === StaticWebAppVirtualTypes.Environment;
}

/** Sorted so the document presents settings in a stable, predictable order. */
function toSettingsMap(properties: Record<string, string> | undefined): SettingsMap {
    return Object.keys(properties ?? {}).sort().map(key => ({ key, value: properties?.[key] ?? '' }));
}

function fromSettingsMap(entries: SettingsMap): Record<string, string> {
    return Object.fromEntries(entries.map(entry => [entry.key, entry.value]));
}
