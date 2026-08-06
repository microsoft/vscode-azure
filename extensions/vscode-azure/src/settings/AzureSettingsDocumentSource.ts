/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getConfiguredAzureEnv, getPortalHost, parseAzureResourceId, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { IVsCode, type SettingsDocumentSource, type SettingsMap, type SettingsSnapshot } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { IAzureViewDataTree } from '../services';
import { createCollectionNode } from '../tree/resources/settings/SettingsNode';
import { ISettingsRegistry } from './SettingsRegistry';
import { SettingsUri, type SettingsUriParts } from './SettingsUri';

/**
 * Bridges settings document URIs to the {@linkcode ISettingsRegistry}.
 *
 * The URI is the only state a settings document carries, which is what lets a document survive a
 * window reload: the editor restores the tab and calls `readFile` before any tree node exists. The
 * URI carries enough context to rebuild the minimal {@linkcode GenericResource} required by the
 * adapter without loading or searching the resource tree.
 */
@injectable()
export class AzureSettingsDocumentSource implements SettingsDocumentSource {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
        @inject(ISettingsRegistry) private readonly registry: ISettingsRegistry,
    ) { }

    /** @inheritdoc */
    public async read(uri: vscode.Uri): Promise<SettingsSnapshot> {
        const { resource, parts } = this.resolve(uri);
        return await this.registry.read(resource, parts.collectionId);
    }

    /** @inheritdoc */
    public async write(uri: vscode.Uri, entries: SettingsMap): Promise<void> {
        const { resource, parts } = this.resolve(uri);
        await this.registry.write(resource, parts.collectionId, entries);

        // The tree renders one node per setting, so a save that added or removed keys changes the
        // node set. Invalidate just the collection subtree, so sibling collections on the same
        // resource keep their cached children.
        this.tree.invalidate(createCollectionNode(resource, parts.collectionId));
    }

    /**
     * Resolve the resource a settings URI addresses.
     *
     * @throws if the URI is malformed or belongs to a different Azure cloud than the one configured.
     */
    private resolve(uri: vscode.Uri): { resource: GenericResource; parts: SettingsUriParts } {
        const parts = SettingsUri.parse(uri);
        const parsedId = parseAzureResourceId(parts.armResourceId);

        const environment = getConfiguredAzureEnv(this.code);
        if (getPortalHost({ environment }).toLowerCase() !== parts.portalHost.toLowerCase()) {
            throw new Error(`Cannot open these settings: the URI belongs to the '${parts.portalHost}' Azure cloud, which is not currently configured.`);
        }

        const resource: GenericResource = {
            id: parts.armResourceId,
            name: parts.resourceName,
            type: parts.resourceType,
            logicalType: parts.logicalType,
            location: parts.location,
            subscription: {
                accountId: parts.accountId,
                tenantId: parts.tenantId,
                subscriptionId: parsedId.subscriptionId,
                displayName: parts.subscriptionDisplayName,
                environment,
            },
        };

        return { resource, parts };
    }
}
