/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    IWebAppClientProvider, parseAzureResourceId,
    type GenericResource, type IWebAppClient,
} from '@microsoft/vscode-azure-azutils';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { SettingsAdapter, SettingsOwner } from '../SettingsAdapter';
import type { SettingsMap, SettingsSnapshot } from '../SettingsModel';
import { isWebApp } from '../../tree/resources/webApp/WebApp';

/**
 * {@linkcode SettingsAdapter} for every `Microsoft.Web/sites` flavour -- Function App, App Service,
 * and Logic App -- exposing application settings.
 *
 * The three products share one ARM surface, so they are one adapter rather than three.
 *
 * @remarks
 * ARM has no per-key patch: `updateApplicationSettings` replaces the whole dictionary. That is why
 * {@linkcode write} sends `entries` verbatim and omitting a key deletes it.
 *
 * Connection strings (`listConnectionStrings`) are deliberately not exposed. They are a separate
 * ARM dictionary, and no shipping Azure extension surfaces them.
 */
@injectable()
export class WebAppSettingsAdapter implements SettingsAdapter {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IWebAppClientProvider) private readonly createClient: IWebAppClientProvider,
    ) { }

    /** @inheritdoc */
    public get label(): string {
        return this.code.l10n.t('Application Settings');
    }

    /** @inheritdoc */
    public canHandle(owner: SettingsOwner): boolean {
        return isWebApp(owner);
    }

    /** @inheritdoc */
    public async read(owner: SettingsOwner): Promise<SettingsSnapshot> {
        const resource = this.resolveResource(owner);
        const { client, resourceGroupName } = this.resolveClient(resource);

        const properties = (await client.webApps.listApplicationSettings(resourceGroupName, resource.name)).properties;

        return {
            entries: toAppSettingEntries(properties),
            resourceName: resource.name,
            label: this.label,
            // ARM permits editing application settings on all three site kinds.
            writable: true,
        };
    }

    /** @inheritdoc */
    public async write(owner: SettingsOwner, entries: SettingsMap): Promise<void> {
        const resource = this.resolveResource(owner);
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

    /** These settings hang off the site itself, so the owner is always the ARM resource. */
    private resolveResource(owner: SettingsOwner): GenericResource {
        if (!isWebApp(owner)) {
            throw new Error('Application settings can only be read from a Microsoft.Web/sites resource.');
        }

        return owner;
    }

    private resolveClient(resource: GenericResource): { client: IWebAppClient; resourceGroupName: string } {
        const { resourceGroup: resourceGroupName } = parseAzureResourceId(resource.id);
        if (!resourceGroupName) {
            throw new Error(`Cannot extract resource group name from resource ID: ${resource.id}`);
        }

        return { client: this.createClient(resource.subscription), resourceGroupName };
    }
}

/** Sorted so the document presents settings in a stable, predictable order. */
function toAppSettingEntries(properties: Record<string, string> | undefined): SettingsMap {
    return Object.keys(properties ?? {}).sort().map(key => ({ key, value: properties?.[key] ?? '' }));
}

function fromAppSettingEntries(entries: SettingsMap): Record<string, string> {
    return Object.fromEntries(entries.map(entry => [entry.key, entry.value]));
}
