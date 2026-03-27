/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ICodeContext, type ViewItemTree, Wizard } from '@microsoft/vscode-azure-utils';
import type { ConcreteAzureNode, ConcreteAzureNodeTree } from '../../models/AzureNode';
import type { GenericResource } from '../../models/GenericResource';
import { type ChooseResourceContext, ChooseResourceStep } from '../../wizard/ChooseResourceStep';

interface ResourceExperienceOptions extends ICodeContext {
    readonly tree: ViewItemTree<string, ConcreteAzureNode>;
    readonly dataItemTree: ConcreteAzureNodeTree;
    readonly logicalType: string;
}

/**
 * Convenience function that runs a wizard with
 * {@linkcode ChooseResourceStep} and returns the picked resource,
 * cast to the caller-specified type.
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
    const wizard = new Wizard<ChooseResourceContext<T>>(
        { picks: [] },
        [
            new ChooseResourceStep<T>({
                ...options,
                logicalType: options.logicalType,
                canPickMany: options.canPickMany,
            }),
        ],
    );

    const result = await wizard.run();

    if (options.canPickMany) {
        return result.resources ?? [];
    }

    if (!result.resource) {
        throw new Error('No resource was picked');
    }

    return result.resource;
}
