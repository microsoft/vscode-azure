/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getNodeType, IResourceClientProvider, isGenericResource, isResourceGroup, isSubscription,
    type ConcreteAzureNode
} from '@microsoft/vscode-azure-azutils';
import {
    Disposable, EventEmitter, Everything, IActionExecutor, IVsCode,
    type ChildResult, type DataProvider, type DataProviderChangeEvent, type ProviderResult
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { ConfigurationSection } from '../../constants';
import { ISettingsDataProvider } from './settings/SettingsDataProvider';

/**
 * Default page size used when fetching paginated Azure resource lists.
 */
const DEFAULT_PAGE_SIZE = 50;

/**
 * Data-layer provider for the resource-group and resource levels of the Azure
 * resources tree.
 *
 * Handles subscriptions (listing their resource groups) and resource groups
 * (listing their resources) via the ARM {@linkcode IResourceClient}. The
 * account / tenant / subscription levels above it are produced by
 * {@linkcode AzureAccountDataProvider}; service-specific providers (e.g.
 * {@linkcode AcrDataProvider}) handle children below the resource group level.
 *
 * Fires {@linkcode onDidChange} when configuration affecting pagination changes.
 */
@injectable()
export class AzureResourceDataProvider implements DataProvider<ConcreteAzureNode>, Disposable {
    private readonly changeEmitter = new EventEmitter<DataProviderChangeEvent<ConcreteAzureNode>>();
    private readonly disposables: Disposable[] = [this.changeEmitter];

    public readonly onDidChange = this.changeEmitter.event;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IResourceClientProvider) private readonly createClient: IResourceClientProvider,
        @inject(ISettingsDataProvider) private readonly settings: ISettingsDataProvider,
    ) {
        this.disposables.push(code.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(`${ConfigurationSection}.pageSize`)) {
                this.executor.output.debug('[data] resources config changed: pageSize');
                this.changeEmitter.fire({ target: Everything });
            }
        }));
    }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is ConcreteAzureNode {
        if (!resource || typeof resource !== 'object') {
            return false;
        }

        const node = resource as ConcreteAzureNode;
        // Resources are claimed too (not just subscriptions and groups) so that any resource with a
        // registered settings adapter grows a settings node without needing a product-specific
        // provider. A product provider that wants its own children registers ahead of this one and
        // composes `ISettingsDataProvider.getSettingsNodes` itself.
        return isSubscription(node) || isResourceGroup(node) || isGenericResource(node);
    }

    /**
     * @inheritdoc
     * @throws if `resource` is not a subscription, resource group, or resource.
     */
    public getChildren(resource?: ConcreteAzureNode): ProviderResult<ChildResult<ConcreteAzureNode>> {
        if (!resource) {
            throw new Error('AzureResourceDataProvider is not a root provider');
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));

        switch (true) {
            case isSubscription(resource): {
                const client = this.createClient(resource);
                this.executor.output.debug(`[data] discover resource groups subscription=${resource.subscriptionId} pageSize=${this.pageSize}`);
                return client.resourceGroups.list({ top: this.pageSize });
            }

            case isResourceGroup(resource): {
                const client = this.createClient(resource.subscription);
                this.executor.output.debug(`[data] discover resources resourceGroup=${resource.subscription.subscriptionId}/${resource.name} pageSize=${this.pageSize}`);
                return client.resources.listByResourceGroup(resource.name, { top: this.pageSize });
            }

            case isGenericResource(resource):
                // Empty for the vast majority of resource types, which have no settings adapter.
                return this.settings.getSettingsNodes(resource);

            default:
                throw new Error(`Unsupported resource type: ${JSON.stringify(resource)}`);
        }
    }

    private get pageSize(): number {
        return this.code.workspace.getConfiguration(ConfigurationSection).get('pageSize', DEFAULT_PAGE_SIZE);
    }

    /** @inheritdoc */
    public dispose(): void {
        Disposable.disposeAll(this.disposables);
    }
}
