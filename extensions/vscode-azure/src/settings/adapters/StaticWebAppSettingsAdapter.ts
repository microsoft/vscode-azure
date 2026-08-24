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
    getStaticWebAppEnvironmentLabel,
    isStaticWebAppEnvironment,
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
 * ARM exposes **two** settings dictionaries per static site, and this adapter deliberately uses the
 * *app settings* pair (`config/appsettings`) rather than the *function app settings* pair:
 *
 * - App settings are what the portal's "Environment variables" blade and
 *   `az staticwebapp appsettings` read and write, so they are what a user means by a site's
 *   settings. They are readable and writable whether or not the site has a managed API.
 * - Function app settings reflect a *deployed* managed function. ARM rejects both reading and
 *   writing them with `Operation not supported: A function must first be deployed to use this
 *   method.` until one exists, so an editor built on them is unusable on any site without an API.
 *
 * The standalone Static Web Apps extension used the function app settings pair, which is why its
 * Application Settings node only appeared once an API had been deployed. That was a limitation of
 * the extension, not of the product.
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
        const { environment, client, resourceGroupName, siteName } = this.resolveClient(owner);

        const properties = environment.isProduction
            ? (await client.staticSites.listStaticSiteAppSettings(resourceGroupName, siteName)).properties
            : (await client.staticSites.listStaticSiteBuildAppSettings(resourceGroupName, siteName, environment.buildId)).properties;

        return {
            entries: toSettingsMap(properties),
            resourceName: `${siteName} (${getStaticWebAppEnvironmentLabel(this.code, environment)})`,
            label: this.label,
            writable: true,
        };
    }

    /** @inheritdoc */
    public async write(owner: SettingsOwner, entries: SettingsMap): Promise<void> {
        const { environment, client, resourceGroupName, siteName } = this.resolveClient(owner);
        this.validateKeys(entries);

        const properties = fromSettingsMap(entries);
        if (environment.isProduction) {
            await client.staticSites.createOrUpdateStaticSiteAppSettings(resourceGroupName, siteName, { properties });
        } else {
            await client.staticSites.createOrUpdateStaticSiteBuildAppSettings(
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

    /**
     * Narrows an owner to an environment and derives everything an ARM call needs from it.
     *
     * The narrowing lives here rather than in a separate step because neither result is useful
     * alone: the client is addressed by the site the environment belongs to, and every operation
     * needs the environment as well to pick between the site-level and build-level endpoints.
     */
    private resolveClient(owner: SettingsOwner): {
        environment: StaticWebAppEnvironment;
        client: IStaticWebAppClient;
        resourceGroupName: string;
        siteName: string;
    } {
        if (!isStaticWebAppEnvironment(owner)) {
            throw new Error(this.code.l10n.t('These settings are only available on a Static Web Apps environment.'));
        }

        const site = owner.azureResource;
        const { resourceGroup: resourceGroupName } = parseAzureResourceId(site.id);
        if (!resourceGroupName) {
            throw new Error(this.code.l10n.t('Could not determine the resource group for the selected Static Web App.'));
        }

        return { environment: owner, client: this.createClient(site.subscription), resourceGroupName, siteName: site.name };
    }
}

/** Sorted so the document presents settings in a stable, predictable order. */
function toSettingsMap(properties: Record<string, string> | undefined): SettingsMap {
    return Object.keys(properties ?? {}).sort().map(key => ({ key, value: properties?.[key] ?? '' }));
}

function fromSettingsMap(entries: SettingsMap): Record<string, string> {
    return Object.fromEntries(entries.map(entry => [entry.key, entry.value]));
}
