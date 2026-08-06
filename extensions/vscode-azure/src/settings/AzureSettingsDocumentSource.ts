/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { findResourceByArmId, type GenericResource } from '@microsoft/vscode-azure-azutils';
import type { SettingsDocumentSource, SettingsMap, SettingsSnapshot } from '@microsoft/vscode-azure-utils';
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
 * window reload: the editor restores the tab and calls `readFile` before any tree node exists, and
 * {@linkcode findResourceByArmId} rebuilds the owning resource from the identity packed into the
 * URI.
 */
@injectable()
export class AzureSettingsDocumentSource implements SettingsDocumentSource {
    public constructor(
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
        @inject(ISettingsRegistry) private readonly registry: ISettingsRegistry,
    ) { }

    /** @inheritdoc */
    public async read(uri: vscode.Uri): Promise<SettingsSnapshot> {
        const { resource, parts } = await this.resolve(uri);
        return await this.registry.read(resource, parts.collectionId);
    }

    /** @inheritdoc */
    public async write(uri: vscode.Uri, entries: SettingsMap): Promise<void> {
        const { resource, parts } = await this.resolve(uri);
        await this.registry.write(resource, parts.collectionId, entries);

        // The tree renders one node per setting, so a save that added or removed keys changes the
        // node set. Invalidate just the collection subtree, so sibling collections on the same
        // resource keep their cached children.
        this.tree.invalidate(createCollectionNode(resource, parts.collectionId));
    }

    /**
     * Resolve the resource a settings URI addresses.
     *
     * @throws if the URI is malformed, or the resource is not reachable from any signed-in account.
     */
    private async resolve(uri: vscode.Uri): Promise<{ resource: GenericResource; parts: SettingsUriParts }> {
        const parts = SettingsUri.parse(uri);

        const resource = await findResourceByArmId(this.tree, parts.armResourceId, parts.tenantId, parts.accountId);
        if (!resource) {
            throw new Error(`Cannot open these settings: the resource '${parts.armResourceId}' was not found. It may have been deleted, or you may need to sign in to the account that owns it.`);
        }

        return { resource, parts };
    }
}
