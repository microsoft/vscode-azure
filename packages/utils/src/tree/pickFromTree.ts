/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from '../vscode/CancellationError';
import type { ITreeItem, IVsCode } from '../vscode/IVsCode';
import type { ProviderResult } from '../vscode/ProviderResult';

// TODO: reimpl based on wizard framework

/**
 * Minimal tree interface required by {@link pickFromTree}.
 * Compatible with {@link ViewItemTree} but decoupled for testability.
 */
interface TreeLike<TViewItem> {
    getChildren(element?: TViewItem): ProviderResult<TViewItem[]>;
    getTreeItem(element: TViewItem): ITreeItem | Promise<ITreeItem>;
}

/**
 * A "create new" option that can appear at any level in the quick pick.
 */
export interface CreateNewOption<TViewItem> {
    /** Label shown in the quick pick (e.g. "Create Function App..."). */
    readonly label: string;

    /**
     * Handler that runs the creation workflow.
     * Return the newly created view item (or throws if an error occurs or creation is cancelled).
     */
    doCreate(): Promise<TViewItem>;
}

/**
 * Configuration for {@link pickFromTree}.
 */
export interface PickFromTreeOptions<TViewItem> {
    /**
     * Title shown in the quick pick header.
     */
    readonly title?: string;

    /**
     * Returns `true` for nodes that can be drilled into (navigated).
     * Items matching neither `isIntermediate` nor `isTerminal` are filtered out.
     */
    isIntermediate(item: TViewItem, treeItem: ITreeItem): boolean;

    /**
     * Returns `true` for nodes that are valid final selections.
     * If both `isIntermediate` and `isTerminal` return `true` for an item,
     * it is treated as **terminal** (selecting it returns immediately).
     */
    isTerminal(item: TViewItem, treeItem: ITreeItem): boolean;

    /**
     * Placeholder text shown in the quick pick at each level.
     * `parent` is `undefined` at the root level.
     */
    getPlaceholder?(parent: TViewItem | undefined): string;

    /**
     * When `true` (the default if omitted), auto-selects the sole
     * matching item at a level without prompting. Return `false` for
     * levels where explicit selection matters (e.g. choosing a
     * subscription for deployment).
     *
     * `parent` is `undefined` at the root level.
     */
    shouldSkipIfOne?(parent: TViewItem | undefined): boolean;

    /**
     * Return a create-new option to append to the quick pick at a given
     * level, or `undefined` to suppress it.
     *
     * `parent` is `undefined` at the root level.
     */
    getCreateNewOption?(parent: TViewItem | undefined): CreateNewOption<TViewItem> | undefined;

    /**
     * When `true`, enables multi-select at levels where **all** visible
     * items are terminal. Intermediate/terminal mixed levels remain
     * single-select.
     *
     * Mutually exclusive with {@link getCreateNewOption} at any given
     * level: if a create-new option is present, multi-select is
     * disabled for that level.
     *
     * Affects the return type: `true` -> `TViewItem[]`, `false`/omitted -> `TViewItem`.
     */
    readonly canPickMany?: boolean;
}

// Internal sentinel for back-button navigation
const BACK: unique symbol = Symbol('back');

// Internal sentinel marking the create-new quick pick item
const CREATE_NEW_RESULT: unique symbol = Symbol('createNewResult');

/**
 * Interactively walk a tree via VS Code quick picks, level by level,
 * until the user selects a terminal item (or cancels).
 *
 * Supports back navigation, skip-if-one, create-new options, and
 * multi-select at fully-terminal levels.
 *
 * @returns The selected view item(s), or `undefined` if cancelled.
 */
export async function pickFromTree<TViewItem>(
    code: IVsCode,
    tree: TreeLike<TViewItem>,
    options: PickFromTreeOptions<TViewItem> & { canPickMany: true },
): Promise<TViewItem[] | undefined>;

export async function pickFromTree<TViewItem>(
    code: IVsCode,
    tree: TreeLike<TViewItem>,
    options: PickFromTreeOptions<TViewItem>,
): Promise<TViewItem | undefined>;

export async function pickFromTree<TViewItem>(
    code: IVsCode,
    tree: TreeLike<TViewItem>,
    options: PickFromTreeOptions<TViewItem>,
): Promise<TViewItem | TViewItem[] | undefined> {
    const stack: (TViewItem | undefined)[] = [];
    let current: TViewItem | undefined;

    for (; ;) {
        const children = await tree.getChildren(current) ?? [];

        // Resolve tree items for all children in parallel
        const resolved = await Promise.all(
            children.map(async (item) => ({
                item,
                treeItem: await tree.getTreeItem(item),
            })),
        );

        // Classify each child
        const intermediateItems: ResolvedItem<TViewItem>[] = [];
        const terminalItems: ResolvedItem<TViewItem>[] = [];

        for (const entry of resolved) {
            const isTerminal = options.isTerminal(entry.item, entry.treeItem);
            const isIntermediate = options.isIntermediate(entry.item, entry.treeItem);

            if (isTerminal) {
                // Terminal takes precedence when both match
                terminalItems.push(entry);
            } else if (isIntermediate) {
                intermediateItems.push(entry);
            }
            // Items matching neither are filtered out
        }

        const createNewOption = options.getCreateNewOption?.(current);
        const totalVisible = intermediateItems.length + terminalItems.length;

        // Dead end: no items and no create option
        if (totalVisible === 0 && !createNewOption) {
            return undefined;
        }

        // Skip-if-one: auto-select sole item when allowed
        const skipIfOne = options.shouldSkipIfOne?.(current) ?? true;
        if (skipIfOne && totalVisible === 1 && !createNewOption) {
            if (terminalItems.length === 1) {
                return options.canPickMany ? [terminalItems[0].item] : terminalItems[0].item;
            }
            // Single intermediate item: navigate into it
            stack.push(current);
            current = intermediateItems[0].item;
            continue;
        }

        // Determine if this level is fully terminal (for canPickMany).
        // Multi-select and create-new are mutually exclusive per level.
        const isFullyTerminal = intermediateItems.length === 0 && terminalItems.length > 0;
        const useMultiSelect = options.canPickMany === true && isFullyTerminal && !createNewOption;

        // Show quick pick
        const result = await showLevelPick(
            code,
            intermediateItems,
            terminalItems,
            {
                title: options.title,
                step: stack.length + 1,
                placeholder: options.getPlaceholder?.(current),
                canPickMany: useMultiSelect,
                showBack: stack.length > 0,
                createNewOption,
            },
        );

        if (result === undefined) {
            // User cancelled
            return undefined;
        }

        if (result === BACK) {
            current = stack.pop();
            continue;
        }

        // Handle create-new
        if (isCreateNewResult<TViewItem>(result)) {
            if (createNewOption) {
                try {
                    const created = await createNewOption.doCreate();
                    return options.canPickMany ? [created] : created;
                } catch (error) {
                    if (CancellationError.test(error)) {
                        // Creation was cancelled by the user; treat as back navigation
                        current = stack.pop();
                        continue;
                    }
                }
            }
        }

        // Handle multi-select result
        if (Array.isArray(result)) {
            return result;
        }

        // Single result — must be a PickItemData at this point
        const pickData = result as PickItemData<TViewItem>;
        if (pickData.kind === 'terminal') {
            return options.canPickMany ? [pickData.item] : pickData.item;
        }

        // Intermediate: drill deeper
        stack.push(current);
        current = pickData.item;
    }
}

// ── Internal types ──────────────────────────────────────────────────

interface ResolvedItem<TViewItem> {
    readonly item: TViewItem;
    readonly treeItem: ITreeItem;
}

interface PickItemData<TViewItem> {
    readonly item: TViewItem;
    readonly kind: 'intermediate' | 'terminal';
}

interface LevelPickOptions<TViewItem> {
    readonly title?: string;
    readonly step: number;
    readonly placeholder?: string;
    readonly canPickMany: boolean;
    readonly showBack: boolean;
    readonly createNewOption?: CreateNewOption<TViewItem>;
}

type CreateNewResult = typeof CREATE_NEW_RESULT;

type LevelPickResult<TViewItem> =
    | typeof BACK
    | CreateNewResult
    | PickItemData<TViewItem>
    | TViewItem[] // multi-select result
    | undefined;

function isCreateNewResult<TViewItem>(result: LevelPickResult<TViewItem>): result is CreateNewResult {
    return result === CREATE_NEW_RESULT;
}

/**
 * Show a single-level quick pick for the given intermediate and terminal items.
 */
async function showLevelPick<TViewItem>(
    code: IVsCode,
    intermediateItems: ResolvedItem<TViewItem>[],
    terminalItems: ResolvedItem<TViewItem>[],
    levelOptions: LevelPickOptions<TViewItem>,
): Promise<LevelPickResult<TViewItem>> {
    interface TaggedQuickPickItem {
        label: string;
        description?: string;
        kind?: number;
        data?: PickItemData<TViewItem> | CreateNewResult;
    }

    const items: TaggedQuickPickItem[] = [];

    // Add intermediate items first
    for (const entry of intermediateItems) {
        const label = treeItemLabel(entry.treeItem);
        items.push({
            label,
            description: appendChevron(entry.treeItem.description),
            data: { item: entry.item, kind: 'intermediate' },
        });
    }

    // Separator between intermediate and terminal if both exist
    if (intermediateItems.length > 0 && terminalItems.length > 0) {
        items.push({ label: '', kind: (code as QuickPickItemKindSource).QuickPickItemKind?.Separator ?? -1 });
    }

    // Add terminal items
    for (const entry of terminalItems) {
        const label = treeItemLabel(entry.treeItem);
        items.push({
            label,
            description: stringifyDescription(entry.treeItem.description),
            data: { item: entry.item, kind: 'terminal' },
        });
    }

    // Add create-new option
    if (levelOptions.createNewOption) {
        items.push({ label: '', kind: (code as QuickPickItemKindSource).QuickPickItemKind?.Separator ?? -1 });
        items.push({
            label: `$(add) ${levelOptions.createNewOption.label}`,
            data: CREATE_NEW_RESULT,
        });
    }

    return new Promise<LevelPickResult<TViewItem>>((resolve) => {
        const quickPick = code.window.createQuickPick<TaggedQuickPickItem>();
        quickPick.title = levelOptions.title;
        quickPick.placeholder = levelOptions.placeholder;
        quickPick.step = levelOptions.step;
        quickPick.matchOnDescription = true;
        quickPick.items = items;
        quickPick.canSelectMany = levelOptions.canPickMany;

        if (levelOptions.showBack) {
            quickPick.buttons = [code.QuickInputButtons.Back];
        }

        let resolved = false;
        const finish = (value: LevelPickResult<TViewItem>) => {
            if (!resolved) {
                resolved = true;
                quickPick.dispose();
                resolve(value);
            }
        };

        quickPick.onDidAccept(() => {
            if (levelOptions.canPickMany) {
                // Multi-select: return all selected terminal items
                const selected = quickPick.selectedItems;
                const selectedViewItems: TViewItem[] = [];
                for (const sel of selected) {
                    const data = sel.data;
                    if (data) {
                        selectedViewItems.push((data as PickItemData<TViewItem>).item);
                    }
                }
                if (selectedViewItems.length > 0) {
                    finish(selectedViewItems);
                }
            } else {
                // Single-select
                const selected = quickPick.activeItems[0];
                if (selected.data) {
                    finish(selected.data);
                }
            }
        });

        quickPick.onDidTriggerButton((button) => {
            if (button === code.QuickInputButtons.Back) {
                finish(BACK);
            }
        });

        quickPick.onDidHide(() => {
            finish(undefined);
        });

        quickPick.show();
    });
}

// ── Helpers ─────────────────────────────────────────────────────────

// Allows access to QuickPickItemKind which may not exist on every IVsCode shape
interface QuickPickItemKindSource {
    QuickPickItemKind?: { Separator: number };
}

/**
 * Extract a string label from an `ITreeItem`.
 * The label can be a string or a `TreeItemLabel` object with a `label` property.
 */
function treeItemLabel(treeItem: ITreeItem): string {
    const raw = treeItem.label;
    if (typeof raw === 'string') {
        return raw;
    }
    if (raw && typeof raw === 'object' && 'label' in raw) {
        return (raw as { label: string }).label;
    }
    return '';
}

/**
 * Convert an ITreeItem description to a string, if it isn't already.
 */
function stringifyDescription(desc: string | boolean | undefined): string | undefined {
    if (typeof desc === 'string') {
        return desc;
    }
    return undefined;
}

/**
 * Append a chevron indicator to a description string to signal
 * that an item can be drilled into.
 */
function appendChevron(desc: string | boolean | undefined): string {
    const base = stringifyDescription(desc);
    return base ? `${base}  $(chevron-right)` : '$(chevron-right)';
}
