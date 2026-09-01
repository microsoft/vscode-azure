/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ICodeContext, type IOutputChannel, type ITreeItem, type PickClassification } from '@microsoft/vscode-azure-utils';
import type { ConcreteAzureNode, ConcreteAzureNodeTree } from '../../models/AzureNode';
import { isGenericResource } from '../../models/AzureNode';
import { AzureNodeId } from '../../models/AzureNodeId';
import type { GenericResource } from '../../models/GenericResource';
import { nodeExperience, type NodeExperienceTree } from './nodeExperience';

interface ResourceExperienceOptions extends ICodeContext {
    readonly tree: NodeExperienceTree;
    readonly dataItemTree: ConcreteAzureNodeTree;
    readonly logicalType?: string;
    readonly output: IOutputChannel;
    readonly title?: string;
}

/**
 * Recursively prompts for a resource, optionally restricted to a single logical
 * type.
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
    const experienceOptions = {
        ...options,
        title: options.title ?? options.code.l10n.t('Select Resource'),
        stepName: 'resource',
        canHandle: (node: ConcreteAzureNode): node is GenericResource =>
            isGenericResource(node)
            && (!options.logicalType || node.logicalType.toLowerCase() === options.logicalType.toLowerCase()),
        classify: (key: string, _treeItem: ITreeItem, node: ConcreteAzureNode | undefined) =>
            classifyForResource(key, node, options.logicalType),
    };

    return options.canPickMany
        ? nodeExperience({ ...experienceOptions, canPickMany: true })
        : nodeExperience({ ...experienceOptions, canPickMany: false });
}

/**
 * Classifies one resource-tree key for a resource picker.
 *
 * Resources matching {@linkcode logicalType} are selectable; the containers
 * above them are navigable. When a `logicalType` is given, the virtual group
 * for that same type is skipped, since drilling into it would offer only the
 * one choice the user already made.
 */
function classifyForResource(
    item: string,
    node: ConcreteAzureNode | undefined,
    logicalType?: string,
): PickClassification {
    const nodeId = AzureNodeId.parse(item);
    if (nodeId.isGenericResourceNodeId()) {
        if (node
            && isGenericResource(node)
            && (!logicalType || node.logicalType.toLowerCase() === logicalType.toLowerCase())) {
            return 'terminal';
        }
        return false;
    }

    if (logicalType && nodeId.isVirtualGroupNodeId() && isMatchingResourceTypeGroup(nodeId, logicalType)) {
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
