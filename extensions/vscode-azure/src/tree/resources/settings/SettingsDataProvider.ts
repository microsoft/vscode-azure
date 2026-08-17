/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConcreteAzureNode, GenericResource } from '@microsoft/vscode-azure-azutils';
import type { DataProvider } from '@microsoft/vscode-azure-utils';
import { injectable, multiInject, optional, type ServiceIdentifier } from 'inversify';
import { ISettingsAdapter, type SettingsAdapter } from '../../../settings/SettingsAdapter';
import { createSettingsNode, isSettingsNode, type SettingsNode } from './SettingsNode';

export const ISettingsDataProvider: ServiceIdentifier<DataProvider<ConcreteAzureNode>> = Symbol.for('ISettingsDataProvider');
export type ISettingsDataProvider = SettingsDataProvider;

/**
 * Data-layer provider for settings nodes, for every product that registers a
 * {@linkcode SettingsAdapter}.
 *
 * It claims only the **virtual** settings node, never the owning resource. The resource itself
 * stays with whichever provider owns it, which is what lets a product provider contribute its own
 * children alongside settings: {@linkcode ProviderRegistry} dispatches to the first `canHandle`
 * match, so two providers cannot both serve one resource.
 *
 * The settings node is produced by {@linkcode getSettingsNodes}, which the resource-owning provider
 * calls. It is a leaf -- the settings themselves are edited as a document, not expanded into the
 * tree -- so this provider returns no children.
 *
 * @remarks
 * Must be registered **before** the generic and product providers in `registerProducts.ts`, so its
 * narrower `canHandle` wins.
 */
@injectable()
export class SettingsDataProvider implements DataProvider<ConcreteAzureNode> {
    public constructor(
        @multiInject(ISettingsAdapter) @optional() private readonly adapters: readonly SettingsAdapter[] = [],
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is ConcreteAzureNode {
        return isSettingsNode(resource);
    }

    /**
     * The adapter that serves {@linkcode resource}, or `undefined` when its product has no settings.
     *
     * Exposed so the view layer can label a settings node, and so the generic view provider can
     * decide whether a resource is expandable at all.
     */
    public getAdapter(resource: GenericResource): SettingsAdapter | undefined {
        return this.adapters.find(adapter => adapter.canHandle(resource));
    }

    /**
     * The settings node for a resource, or an empty array when the product exposes none.
     *
     * Called by the provider that owns the resource, so settings appear under every supported
     * resource without that provider knowing which products have settings. Returns an array so
     * callers can splice it straight into their children.
     */
    public getSettingsNodes(resource: GenericResource): SettingsNode[] {
        return this.getAdapter(resource) ? [createSettingsNode(resource)] : [];
    }

    /** @inheritdoc */
    public getChildren(): Promise<ConcreteAzureNode[]> {
        // A settings node is a leaf: its contents are edited as a document.
        return Promise.resolve([]);
    }
}
