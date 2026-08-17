/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import type { DataProvider } from '@microsoft/vscode-azure-utils';
import { injectable } from 'inversify';
import { isSettingsNode } from './SettingsNode';

/**
 * Data-layer provider that claims settings virtual nodes and reports them as leaves.
 *
 * It claims only the **virtual** settings node, never the owning resource. The resource itself
 * stays with whichever provider owns it, which is what lets a product provider contribute its own
 * children alongside settings: {@linkcode ProviderRegistry} dispatches to the first `canHandle`
 * match, so two providers cannot both serve one resource.
 *
 * Settings nodes are produced by {@linkcode getSettingsNodes}, which resource-owning providers call
 * with their product adapter.
 *
 * @remarks
 * Must be registered **before** the generic and product providers in `registerProducts.ts`, so its
 * narrower `canHandle` wins.
 */
@injectable()
export class SettingsDataProvider implements DataProvider<ConcreteAzureNode> {
    /** @inheritdoc */
    public canHandle(resource: unknown): resource is ConcreteAzureNode {
        return isSettingsNode(resource);
    }

    /** @inheritdoc */
    public getChildren(): Promise<ConcreteAzureNode[]> {
        // A settings node is a leaf: its contents are edited as a document.
        return Promise.resolve([]);
    }
}
