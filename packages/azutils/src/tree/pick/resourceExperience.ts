/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ICodeContext, type IOutputChannel, type ITreeItem, type ViewItemTree } from '@microsoft/vscode-azure-utils';
import type { ConcreteAzureNode, ConcreteAzureNodeTree } from '../../models/AzureNode';
import { isGenericResource } from '../../models/AzureNode';
import type { GenericResource } from '../../models/GenericResource';
import { classifyForResource } from '../../wizard/ChooseResourceStep';
import { nodeExperience } from './nodeExperience';

interface ResourceExperienceOptions extends ICodeContext {
    readonly tree: ViewItemTree<string, ConcreteAzureNode>;
    readonly dataItemTree: ConcreteAzureNodeTree;
    readonly logicalType: string;
    readonly output: IOutputChannel;
}

/**
 * Convenience function that recursively prompts for a resource of the requested
 * logical type.
 *
 * @typeParam T - The expected concrete resource type (must extend
 *   {@linkcode GenericResource}).
 */
export async function resourceExperience<T extends GenericResource>(
    options: ResourceExperienceOptions & { canPickMany: true },
): Promise<T[]>;
export async function resourceExperience<T extends GenericResource>(
    options: ResourceExperienceOptions & { canPickMany?: false },
): Promise<T>;
export async function resourceExperience<T extends GenericResource>(
    options: ResourceExperienceOptions & { canPickMany?: boolean },
): Promise<T | T[]> {
    const experienceOptions = {
        ...options,
        title: options.code.l10n.t('Select Resource'),
        stepName: 'resource',
        canHandle: (node: ConcreteAzureNode): node is T =>
            isGenericResource(node) && node.logicalType.toLowerCase() === options.logicalType.toLowerCase(),
        classify: (key: string, _treeItem: ITreeItem, node: ConcreteAzureNode | undefined) =>
            classifyForResource(key, node, options.logicalType),
    };

    return options.canPickMany
        ? nodeExperience({ ...experienceOptions, canPickMany: true })
        : nodeExperience({ ...experienceOptions, canPickMany: false });
}
