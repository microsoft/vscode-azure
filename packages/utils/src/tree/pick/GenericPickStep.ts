/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type QuickPickItemWithData, showSmartQuickPick } from '../../ui/uiHelpers';
import type { ICodeContext, ITreeItem } from '../../vscode/IVsCode';
import type { ProviderResult } from '../../vscode/ProviderResult';
import { PromptStep } from '../../wizard/PromptStep';
import { getLastPick, type PickContext, type PickPair } from './PickContext';

export type GenericPickOptions<TItem> = ICodeContext & {
    readonly tree: TreeLike<TItem>;

    isIntermediate(item: TItem, treeItem: ITreeItem): boolean;
    isTerminal(item: TItem, treeItem: ITreeItem): boolean;

    readonly skipIfOne?: boolean;

    readonly canPickMany?: boolean;
    readonly create?: CreateNewOption<TItem>;
} & ({ canPickMany: true } | { create: CreateNewOption<TItem> } | { canPickMany?: false, create?: undefined }); // TODO: make skipIfOne mutually exclusive with create?

export class GenericPickStep<TItem, TOptions extends GenericPickOptions<TItem> = GenericPickOptions<TItem>> extends PromptStep<PickContext<TItem>> {
    public constructor(protected readonly options: TOptions) {
        super();
    }

    public async prompt(context: Readonly<PickContext<TItem>>): Promise<Partial<PickContext<TItem>>> {
        const lastPick = getLastPick(context);
        const children = await this.getPickItems(lastPick?.item);
        const picks = this.getPicks(children);

        if (this.options.skipIfOne && picks.length === 1 && picks[0].data !== CreateNew) {
            return { picks: [...context.picks, picks[0].data] };
        }

        const choice = await showSmartQuickPick(this.options, picks, {
            canPickMany: this.options.canPickMany,
            showBack: true,
            matchOnDescription: true,
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

            const isIntermediate = this.options.isIntermediate(childItem, treeItem);
            const isTerminal = this.options.isTerminal(childItem, treeItem);

            if (isIntermediate || isTerminal) {
                children.push({ item: childItem, treeItem, isIntermediate, isTerminal });
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
    isIntermediate: boolean;
    isTerminal: boolean;
}

interface CreateNewOption<TItem> {
    readonly label: string;
    createNewItem(): TItem | Promise<TItem>;
}

const CreateNew: unique symbol = Symbol('CreateNew');
