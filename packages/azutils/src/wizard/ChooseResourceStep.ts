/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getLastPick, RecursivePickStep,
    type ExclusivePickManyOrCreate, type GenericPickOptions, type PickClassification, type PickContext
} from '@microsoft/vscode-azure-utils';
import { isGenericResource, type ConcreteAzureNodeTree } from '../models/AzureNode';
import { AzureNodeId } from '../models/AzureNodeId';
import type { GenericResource } from '../models/GenericResource';

/**
 * Context shape required by {@linkcode ChooseResourceStep}.
 * Callers must ensure their wizard context extends this.
 *
 * @typeParam T - The expected resource type.
 */
export interface ChooseResourceContext<T extends GenericResource = GenericResource> extends PickContext<string> {
    readonly resource?: T;
    readonly resources?: T[];
}

interface ChooseResourceOptions extends GenericPickOptions<string> {
    readonly dataItemTree: ConcreteAzureNodeTree;
    readonly logicalType: string;
}

/**
 * A recursive pick step that drills through the resource tree to
 * find a resource matching a specific {@linkcode GenericResource.logicalType}.
 * Virtual groups matching the target type are auto-skipped.
 */
export class ChooseResourceStep<TResource extends GenericResource, TContext extends ChooseResourceContext<TResource> = ChooseResourceContext<TResource>> extends RecursivePickStep<string, ChooseResourceOptions> {
    public constructor(options: Omit<ChooseResourceOptions, 'classify'> & ExclusivePickManyOrCreate<string>) {
        super(
            {
                title: options.code.l10n.t('Select Resource'),
                stepName: 'resource',
                ...options,
                classify: (item: string) => classifyForResource(AzureNodeId.parse(item), item, options),
            },
            ChooseResourceStep
        );
    }

    /**
     * @inheritdoc
     *
     * In addition to the base recursive pick behavior, resolves the
     * picked terminal resource (or resources, when
     * `canPickMany: true`) into the data-layer node(s) and sets
     * {@linkcode ChooseResourceContext.resource} /
     * {@linkcode ChooseResourceContext.resources} on the context.
     */
    public override async prompt(context: Readonly<TContext>): Promise<Partial<TContext>> {
        const pickResult = await super.prompt(context);

        const merged = { ...context, ...pickResult };

        if (merged.selectedTerminalPicks?.length) {
            // All multi-picked items were already classified as terminal,
            // so just resolve each key to its data-layer node.
            const resources = merged.selectedTerminalPicks
                .map(key => this.options.dataItemTree.get(key))
                .filter((node): node is TResource => !!node);
            return { ...pickResult, resources } as Partial<TContext>;
        }

        const lastPick = getLastPick(merged);
        if (lastPick && this.options.classify(lastPick.item, lastPick.treeItem) === 'terminal') {
            const node = this.options.dataItemTree.get(lastPick.item);
            if (node) {
                return { ...pickResult, resource: node as TResource } as Partial<TContext>;
            }
        }

        return pickResult as Partial<TContext>;
    }
}

function classifyForResource(nodeId: AzureNodeId, item: string, options: Omit<ChooseResourceOptions, 'classify'>): PickClassification {
    if (nodeId.isGenericResourceNodeId()) {
        const node = options.dataItemTree.get(item);
        if (node && isGenericResource(node) && node.logicalType.toLowerCase() === options.logicalType.toLowerCase()) {
            return 'terminal';
        }
        return false;
    }

    if (nodeId.isVirtualGroupNodeId() && isMatchingResourceTypeGroup(nodeId, options.logicalType)) {
        return 'skip';
    }

    if (nodeId.isAccountNodeId()
        || nodeId.isTenantNodeId()
        || nodeId.isSubscriptionNodeId()
        || nodeId.isResourceGroupNodeId()
        || nodeId.isVirtualGroupNodeId()) {
        return 'intermediate';
    }

    return false;
}

function isMatchingResourceTypeGroup(nodeId: AzureNodeId, logicalType: string): boolean {
    const grouping = nodeId.getGrouping();
    return grouping?.groupingStrategy === 'resourceType'
        && grouping.groupingValue.toLowerCase() === logicalType.toLowerCase();
}
