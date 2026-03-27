/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { type ExtendedQuickPickOptions, type QuickPickItemWithData, showSmartQuickPick } from '../../ui/uiHelpers';
import type { ICodeContext, ITreeItem } from '../../vscode/IVsCode';
import type { ProviderResult } from '../../vscode/ProviderResult';
import { PromptStep } from '../../wizard/PromptStep';
import { getLastPick, type PickContext, type PickPair } from './PickContext';

export interface CreateNewOption<TItem> {
    readonly label: string;
    createNewItem(): TItem | Promise<TItem>;
}

/**
 * Classification result for an item in the pick list.
 * - `'intermediate'` -- a drillable node (e.g. account, tenant, subscription)
 * - `'skip'` -- an intermediate node that should be auto-selected when it is the only pick
 * - `'terminal'` -- a selectable leaf node
 * - `false` -- the item should be hidden from the picker
 */
export type PickClassification = 'intermediate' | 'skip' | 'terminal' | false;

export interface GenericPickOptions<TItem> extends ICodeContext {
    readonly tree: TreeLike<TItem> | vscode.TreeDataProvider<TItem>;

    classify(item: TItem, treeItem: ITreeItem): PickClassification;

    readonly canPickMany?: boolean;
    readonly create?: CreateNewOption<TItem>;
}

/** This type ensures that `canPickMany` and `create` cannot both be specified at the same time */
export type ExclusivePickManyOrCreate<TItem> = ({ canPickMany: true } | { create: CreateNewOption<TItem> } | { canPickMany?: false, create?: never });

export class GenericPickStep<TItem, TOptions extends GenericPickOptions<TItem>> extends PromptStep<PickContext<TItem>> {
    public constructor(protected readonly options: TOptions & ExclusivePickManyOrCreate<TItem>) {
        super();
    }

    public async prompt(context: Readonly<PickContext<TItem>>): Promise<Partial<PickContext<TItem>>> {
        const lastPick = getLastPick(context);
        const children = await this.getPickItems(lastPick?.item);
        const picks = this.getPicks(children);

        if (picks.length === 1) {
            // Skipping only makes sense if there's no create option and the only pick is an intermediate item--if it's terminal, we want to make the user be explicit about choosing it
            const onlyPick = picks[0];
            if (onlyPick.data !== CreateNew &&
                onlyPick.data.isIntermediate &&
                onlyPick.data.shouldSkip) {
                return { picks: [...context.picks, onlyPick.data] };
            }
        }

        // `canPickMany` only applies if all of the selectable items are terminal *and* there is no create option
        const canPickMany = this.options.canPickMany && !this.options.create && children.every(c => c.isTerminal && !c.isIntermediate);

        if (canPickMany) {
            const choices = await showSmartQuickPick(this.options, picks, {
                ...DefaultQuickPickOptions,
                canPickMany: true,
                // TODO: more options, e.g. step name, etc.
            }) as QuickPickItemWithData<FilteredChild<TItem>>[]; // Can't be `CreateNew` since create isn't allowed with `canPickMany`

            return { selectedTerminalPicks: choices.map(c => c.data.item) };
        } else {
            const choice = await showSmartQuickPick(this.options, picks, {
                ...DefaultQuickPickOptions,
                // TODO: more options, e.g. step name, etc.
            });

            if (choice.data === CreateNew) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const newItem = await this.options.create!.createNewItem();
                return { picks: [...context.picks, { item: newItem, treeItem: await this.options.tree.getTreeItem(newItem) }] };
            } else {
                return { picks: [...context.picks, choice.data] };
            }
        }
    }

    private getPicks(items: FilteredChild<TItem>[]): QuickPickItemWithData<FilteredChild<TItem> | typeof CreateNew>[] {
        const picks: QuickPickItemWithData<FilteredChild<TItem> | typeof CreateNew>[] = items.map(child => {
            const treeItemLabel = typeof child.treeItem.label === 'string' ? child.treeItem.label : child.treeItem.label?.label;
            const treeItemDescription = typeof child.treeItem.description === 'string' ? child.treeItem.description : undefined;

            if (!treeItemLabel) {
                return undefined; // No label--skip the item
            }

            return {
                label: child.isIntermediate ? `${treeItemLabel} $(chevron-right)` : treeItemLabel,
                description: treeItemDescription,
                data: child,
                iconPath: typeof child.treeItem.iconPath === 'string' ? undefined : child.treeItem.iconPath,
            };
        }).filter(Boolean) as QuickPickItemWithData<FilteredChild<TItem>>[];

        if (this.options.create) {
            picks.push({
                label: `$(add) ${this.options.create.label}`,
                data: CreateNew, // Will be created in the pick handler
            });
        }

        return picks;
    }

    private async getPickItems(parentItem?: TItem): Promise<FilteredChild<TItem>[]> {
        const children: FilteredChild<TItem>[] = [];

        for (const childItem of await this.options.tree.getChildren(parentItem) ?? []) {
            const treeItem = await this.options.tree.getTreeItem(childItem);

            const classification = this.options.classify(childItem, treeItem);
            if (classification) {
                children.push({
                    item: childItem,
                    treeItem,
                    isIntermediate: classification === 'intermediate' || classification === 'skip',
                    isTerminal: classification === 'terminal',
                    shouldSkip: classification === 'skip',
                });
            }
        }

        if (children.length === 0) {
            // TODO: Throw only if no items at the root? Otherwise allow for go-back?
            throw new Error(this.options.code.l10n.t('No items found.'));
        }

        return children;
    }
}

interface TreeLike<TItem> {
    getChildren(item: TItem | undefined): ProviderResult<TItem[]>;
    getTreeItem(item: TItem): ITreeItem | Promise<ITreeItem>;
}

/**
 * Represents a pick pair where the intermediate/terminal status is already computed.
 * @internal - not intended for public consumption, but exported for use in RecursivePickStep
 */
export interface FilteredChild<TItem> extends PickPair<TItem> {
    readonly isIntermediate: boolean;
    readonly isTerminal: boolean;
    readonly shouldSkip: boolean;
}

const CreateNew: unique symbol = Symbol('CreateNew');

const DefaultQuickPickOptions: ExtendedQuickPickOptions<vscode.QuickPickItem> = {
    showBack: true,
    matchOnDescription: true,
};
