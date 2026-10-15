/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessSet, type ICaselessSetReader, type ICodeContext, type IOutputChannel, type ITreeItem, type PickClassification } from '@microsoft/vscode-azure-utils';
import type { ConcreteAzureNode, ConcreteAzureNodeTree } from '../../models/AzureNode';
import { isGenericResource } from '../../models/AzureNode';
import { AzureNodeId } from '../../models/AzureNodeId';
import type { GenericResource } from '../../models/GenericResource';
import { nodeExperience, type NodeExperienceTree } from './nodeExperience';

interface ResourceExperienceOptions extends ICodeContext {
    readonly tree: NodeExperienceTree;
    readonly dataItemTree: ConcreteAzureNodeTree;
    /** Allowed logical types; omitted accepts every type, while an empty array accepts none. */
    readonly logicalTypes?: readonly string[];
    readonly output: IOutputChannel;
    readonly title?: string;
}

/**
 * Recursively prompts for a resource, optionally restricted to logical types
 * compared case-insensitively.
 *
 * @returns The picked resource(s). Callers wanting a narrower type should
 *   narrow the result themselves with the matching type guard, since the
 *   logical type is an optional filter and cannot prove a concrete type here.
 */
export async function resourceExperience(
    options: ResourceExperienceOptions & { canPickMany: true },
): Promise<GenericResource[]>;
export async function resourceExperience(
    options: ResourceExperienceOptions & { canPickMany?: false },
): Promise<GenericResource>;
export async function resourceExperience(
    options: ResourceExperienceOptions & { canPickMany?: boolean },
): Promise<GenericResource | GenericResource[]> {
    const logicalTypes: ICaselessSetReader | undefined = options.logicalTypes ? new CaselessSet(options.logicalTypes) : undefined;
    const experienceOptions = {
        ...options,
        title: options.title ?? options.code.l10n.t('Select Resource'),
        stepName: 'resource',
        canHandle: (node: ConcreteAzureNode): node is GenericResource =>
            isGenericResource(node)
            && (!logicalTypes || logicalTypes.has(node.logicalType)),
        classify: (key: string, _treeItem: ITreeItem, node: ConcreteAzureNode | undefined) =>
            classifyForResource(key, node, logicalTypes),
    };

    return options.canPickMany
        ? nodeExperience({ ...experienceOptions, canPickMany: true })
        : nodeExperience({ ...experienceOptions, canPickMany: false });
}

/**
 * Classifies one resource-tree key for a resource picker.
 *
 * Resources matching {@linkcode logicalTypes} are selectable; the containers
 * above them are navigable. When exactly one logical type is requested, its
 * resource-type group is skipped because the type is already determined.
 */
function classifyForResource(
    item: string,
    node: ConcreteAzureNode | undefined,
    logicalTypes?: ICaselessSetReader,
): PickClassification {
    const nodeId = AzureNodeId.parse(item);
    if (nodeId.isGenericResourceNodeId()) {
        if (node
            && isGenericResource(node)
            && (!logicalTypes || logicalTypes.has(node.logicalType))) {
            return 'terminal';
        }
        return false;
    }

    if (logicalTypes?.size === 1 && nodeId.isVirtualGroupNodeId() && isMatchingResourceTypeGroup(nodeId, logicalTypes)) {
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

function isMatchingResourceTypeGroup(nodeId: AzureNodeId, logicalTypes: ICaselessSetReader): boolean {
    const grouping = nodeId.getGrouping();
    return grouping?.groupingStrategy === 'resourceType'
        && logicalTypes.has(grouping.groupingValue);
}
