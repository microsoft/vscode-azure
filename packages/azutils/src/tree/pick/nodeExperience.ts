/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getLastPick,
    RecursivePickStep,
    Wizard,
    type ICodeContext,
    type IOutputChannel,
    type ITreeItem,
    type PickClassification,
    type PickContext,
    type ProviderResult,
} from '@microsoft/vscode-azure-utils';
import type { ConcreteAzureNode, ConcreteAzureNodeTree } from '../../models/AzureNode';

/** Tree surface required by {@linkcode nodeExperience}. */
export interface NodeExperienceTree {
    getChildren(item?: string): ProviderResult<string[]>;
    getTreeItem(item: string): ITreeItem | Promise<ITreeItem>;
}

/**
 * Configures recursive selection of a typed node from the Azure resource tree.
 *
 * The classifier controls navigation and terminal choices; {@linkcode canHandle}
 * validates the selected data-layer node before it is returned.
 */
export interface NodeExperienceOptions<TNode extends ConcreteAzureNode> extends ICodeContext {
    readonly tree: NodeExperienceTree;
    readonly dataItemTree: ConcreteAzureNodeTree;
    readonly output: IOutputChannel;
    readonly canPickMany?: boolean;
    readonly title?: string;
    readonly stepName?: string;
    canHandle(node: ConcreteAzureNode): node is TNode;
    classify(key: string, treeItem: ITreeItem, node: ConcreteAzureNode | undefined): PickClassification;
}

/**
 * Recursively prompts for one or more typed nodes from the Azure resource tree.
 *
 * @throws if a selected key no longer identifies a node accepted by
 * {@linkcode NodeExperienceOptions.canHandle canHandle}.
 */
export async function nodeExperience<TNode extends ConcreteAzureNode>(
    options: NodeExperienceOptions<TNode> & { readonly canPickMany: true },
): Promise<TNode[]>;
export async function nodeExperience<TNode extends ConcreteAzureNode>(
    options: NodeExperienceOptions<TNode> & { readonly canPickMany?: false },
): Promise<TNode>;
export async function nodeExperience<TNode extends ConcreteAzureNode>(
    options: NodeExperienceOptions<TNode>,
): Promise<TNode | TNode[]> {
    const recursiveOptions = {
        code: options.code,
        extensionContext: options.extensionContext,
        tree: options.tree,
        title: options.title,
        stepName: options.stepName,
        classify: (key: string, treeItem: ITreeItem) => options.classify(key, treeItem, options.dataItemTree.get(key)),
    };
    const step = options.canPickMany
        ? new RecursivePickStep<string, typeof recursiveOptions>({ ...recursiveOptions, canPickMany: true })
        : new RecursivePickStep<string, typeof recursiveOptions>(recursiveOptions);

    const result = await new Wizard<PickContext<string>>(options.output, {}, [step]).run();
    if (options.canPickMany) {
        return (result.selectedTerminalPicks ?? []).map(resolve);
    }

    const key = getLastPick(result)?.item;
    if (!key) {
        throw new Error(options.code.l10n.t('No item was picked'));
    }

    return resolve(key);

    function resolve(key: string): TNode {
        const node = options.dataItemTree.get(key);
        if (!node || !options.canHandle(node)) {
            throw new Error(options.code.l10n.t('The selected item is no longer available.'));
        }

        return node;
    }
}
