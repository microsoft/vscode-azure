/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getNodeType, type ConcreteAzureNode, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, type DataProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import { ISettingsRegistry } from '../../../settings/SettingsRegistry';
import {
    collectionIdOf, createCollectionNode, createEntryNode, isSettingsCollectionNode, isSettingsNode,
    type SettingsCollectionNode,
} from './SettingsNode';

export const ISettingsDataProvider: ServiceIdentifier<DataProvider<ConcreteAzureNode>> = Symbol.for('ISettingsDataProvider');
export type ISettingsDataProvider = SettingsDataProvider;

/**
 * Data-layer provider for settings nodes, for every product that registers a
 * {@linkcode SettingsAdapter}.
 *
 * It claims only the **virtual** settings nodes, never the owning resource. The resource itself
 * stays with whichever provider owns it, which is what lets a product provider contribute its own
 * children alongside settings: {@linkcode ProviderRegistry} dispatches to the first `canHandle`
 * match, so two providers cannot both serve one resource.
 *
 * The collection nodes are produced by {@linkcode getCollectionNodes}, which the resource-owning
 * provider calls. This provider expands a collection into one node per setting.
 *
 * @remarks
 * Must be registered **before** the generic and product providers in `registerTrees.ts`, so its
 * narrower `canHandle` wins.
 */
@injectable()
export class SettingsDataProvider implements DataProvider<ConcreteAzureNode> {
    public constructor(
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(ISettingsRegistry) private readonly registry: ISettingsRegistry,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is ConcreteAzureNode {
        return isSettingsNode(resource);
    }

    /**
     * The settings collection nodes for a resource, or an empty array when the product exposes
     * none.
     *
     * Called by the provider that owns the resource, so settings appear under every supported
     * resource without that provider knowing which products have settings.
     */
    public getCollectionNodes(resource: GenericResource): SettingsCollectionNode[] {
        return this.registry
            .getCollections(resource)
            .map(collection => createCollectionNode(resource, collection.id));
    }

    /** @inheritdoc */
    public async getChildren(resource?: ConcreteAzureNode): Promise<ConcreteAzureNode[]> {
        // Only a collection node has children; individual settings are leaves.
        if (!resource || !isSettingsCollectionNode(resource)) {
            return [];
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));

        const collectionId = collectionIdOf(resource);
        const snapshot = await this.registry.read(resource.azureResource, collectionId);

        // Setting keys and values are user data and must never reach telemetry or logs.
        return snapshot.entries.map(entry => createEntryNode(resource.azureResource, collectionId, entry));
    }
}
