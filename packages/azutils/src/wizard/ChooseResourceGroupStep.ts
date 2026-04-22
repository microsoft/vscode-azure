/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import {
    getLastPick, RecursivePickStep,
    type ExclusivePickManyOrCreate, type GenericPickOptions, type IOutputChannel, type ITreeItem, type PickClassification, type PickContext
} from '@microsoft/vscode-azure-utils';
import { isAccount, isResourceGroup, isSubscription, isTenant, type ConcreteAzureNode, type ConcreteAzureNodeTree } from '../models/AzureNode';
import { AzureNodeId } from '../models/AzureNodeId';
import type { ResourceGroup } from '../models/Grouping';

/**
 * Context shape required by {@linkcode ChooseResourceGroupStep}.
 * Callers must ensure their wizard context extends this.
 */
export interface ChooseResourceGroupContext extends PickContext<string> {
    readonly subscription?: AzureSubscription;
    readonly resourceGroup?: ResourceGroup;
}

interface ChooseResourceGroupOptions extends Omit<GenericPickOptions<string>, 'canPickMany'> {
    readonly dataItemTree: ConcreteAzureNodeTree;
    readonly output: IOutputChannel;
}

/**
 * A recursive pick step that drills through Account > Tenant >
 * Subscription > Resource Group. When a resource group is picked,
 * sets both {@linkcode ChooseResourceGroupContext.subscription} and
 * {@linkcode ChooseResourceGroupContext.resourceGroup} on the wizard
 * context.
 */
export class ChooseResourceGroupStep<TContext extends ChooseResourceGroupContext> extends RecursivePickStep<string, ChooseResourceGroupOptions> {
    public constructor(options: Omit<ChooseResourceGroupOptions, 'classify' | 'tree'>) {
        const tree = new ResourceGroupViewItemTree(options.dataItemTree, options.output);
        super(
            {
                title: options.code.l10n.t('Select Resource Group'),
                stepName: 'resourceGroup',
                ...options,
                classify: (key: string) => classifyForResourceGroup(AzureNodeId.parse(key)),
                tree
            } as ChooseResourceGroupOptions & ExclusivePickManyOrCreate<string>,
            ChooseResourceGroupStep,
        );
    }

    /**
     * @inheritdoc
     *
     * In addition to the base recursive pick behavior, resolves the
     * picked terminal resource group into the data-layer node and
     * sets both {@linkcode ChooseResourceGroupContext.subscription}
     * and {@linkcode ChooseResourceGroupContext.resourceGroup} on
     * the context.
     */
    public override async prompt(context: Readonly<TContext>): Promise<Partial<TContext>> {
        const pickResult = await super.prompt(context);

        // In order to set the `subscription` / `resourceGroup` properties on the context,
        // we need to get the last picked item and see if it's a resource group.
        // If it is, we can pull the subscription and resource group info from the node.
        const lastPick = getLastPick({ ...context, ...pickResult });
        if (lastPick && this.options.classify(lastPick.item, lastPick.treeItem) === 'terminal') {
            const node = this.options.dataItemTree.get(lastPick.item);
            if (node && isResourceGroup(node)) {
                return {
                    ...pickResult,
                    subscription: node.subscription,
                    resourceGroup: node,
                } as Partial<TContext>;
            }
        }

        return pickResult as Partial<TContext>;
    }
}

function classifyForResourceGroup(nodeId: AzureNodeId): PickClassification {
    if (nodeId.isAccountNodeId() || nodeId.isTenantNodeId() || nodeId.isSubscriptionNodeId()) {
        return 'intermediate';
    } else if (nodeId.isResourceGroupNodeId()) {
        return 'terminal';
    }
    return false;
}

/**
 * Creates a tree adapter for resource group picking that reads
 * from a {@linkcode ConcreteAzureNodeTree}.
 */
class ResourceGroupViewItemTree {
    public constructor(
        private readonly dataItemTree: ConcreteAzureNodeTree,
        private readonly output: IOutputChannel,
    ) { }

    public async getChildren(key?: string): Promise<string[]> {
        this.output.debug(`[wizard] fetch resource-group picker children start key=${key ?? '<root>'}`);
        let node: ConcreteAzureNode | undefined = undefined;
        if (key) {
            node = this.dataItemTree.get(key);
            if (!node) {
                throw new Error(`Could not find node for key: ${key}`);
            }
        }
        const children = (await this.dataItemTree.getChildren(node)).map(child => AzureNodeId.from(child).toString());
        this.output.debug(`[wizard] fetch resource-group picker children done key=${key ?? '<root>'} count=${children.length}`);
        return children;
    }

    public getTreeItem(key: string): ITreeItem {
        const node = this.dataItemTree.get(key);
        if (!node) {
            throw new Error(`Could not find node for key: ${key}`);
        }

        switch (true) {
            case isAccount(node):
                return { label: node.label, id: key };
            case isTenant(node):
                return { label: node.displayName, id: key };
            case isSubscription(node):
                return { label: node.name, id: key };
            case isResourceGroup(node):
                return { label: node.name, id: key };
            default:
                throw new Error(`Unexpected node: ${key}`);
        }
    }
}
