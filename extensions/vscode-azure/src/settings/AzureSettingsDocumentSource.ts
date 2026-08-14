/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { IAzureViewDataTree } from '../services';
import { isSettingsNode, type SettingsNode } from '../tree/resources/settings/SettingsNode';
import type { SettingsDocumentSource } from './core/SettingsFileSystemProvider';
import type { SettingsMap, SettingsSnapshot } from './core/SettingsModel';
import { ISettingsRegistry } from './SettingsRegistry';
import { SettingsUri } from './SettingsUri';

/**
 * Bridges settings document URIs to the {@linkcode ISettingsRegistry}.
 *
 * A settings URI carries the settings node's tree key, so resolving one is a direct lookup in the
 * data tree. The resource handed to the adapter is therefore always the same object the tree loaded
 * from Azure -- never one rebuilt from the URI, which could disagree with reality.
 *
 * The consequence is that a document only resolves while its node is in the tree. That covers the
 * ordinary case (the document was opened from the tree, and the tree caches it), but a document
 * restored by the editor after a window reload will not resolve until the tree has loaded that node.
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
        return await this.registry.read(this.resolve(uri).azureResource);
    }

    /** @inheritdoc */
    public async write(uri: vscode.Uri, entries: SettingsMap): Promise<void> {
        const node = this.resolve(uri);
        await this.registry.write(node.azureResource, entries);

        this.tree.invalidate(node);
    }

    /**
     * Resolve the settings node a URI addresses.
     *
     * @throws if the URI is malformed, or its node is not currently in the tree.
     */
    private resolve(uri: vscode.Uri): SettingsNode {
        const node = this.tree.get(SettingsUri.parseNodeKey(uri));

        if (!isSettingsNode(node)) {
            throw new Error(this.code.l10n.t('These settings are no longer available. Open them again from the Azure view.'));
        }

        return node;
    }
}
