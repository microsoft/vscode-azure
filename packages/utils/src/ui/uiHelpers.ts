/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import type * as vscode from 'vscode';
import { delay } from '../base/delay';
import { CancellationError } from '../vscode/CancellationError';
import type { ICodeContext, IVsCode } from '../vscode/IVsCode';
import { GoBackError } from '../wizard/GoBackError';

/** A {@linkcode vscode.QuickPickItem} with associated underlying data */
export interface QuickPickItemWithData<T> extends vscode.QuickPickItem {
    readonly data: T;
}

/** Options for quick pick boxes that support a back button, cancellation, and preset values */
export interface ExtendedQuickPickOptions<TItem extends vscode.QuickPickItem> extends vscode.QuickPickOptions, StepOptions {
    /** Predicate to determine which item should be pre-highlighted. The first matching item wins. */
    readonly isActiveItem?: (item: TItem) => boolean;

    /** Predicate to determine which items are pre-selected when {@linkcode vscode.QuickPickOptions.canPickMany} is true. */
    readonly isSelectedItem?: (item: TItem) => boolean;

    /** Preset filter string */
    readonly value?: string;

    /** Called when a button on a specific quick pick item is triggered. */
    readonly onDidTriggerItemButton?: (event: vscode.QuickPickItemButtonEvent<TItem>) => void;

    /**
     * Turns the quick pick into a combo box ("pick or enter"): builds a synthetic,
     * always-shown item from the user's typed text whenever it does not already match
     * a suggestion. It receives the **trimmed** typed value and should return `undefined`
     * when no custom item should be offered (typically when the value is empty).
     *
     * If the returned item's `label` duplicates one of the existing `items`, the
     * synthetic item is suppressed and that real suggestion is activated instead, so
     * the user never sees two identical-looking rows. When the user accepts the
     * synthetic item, it is returned from {@linkcode showSmartQuickPick} like any other
     * item, but is intentionally not stored as the "recently picked" choice (its label
     * is not one of the suggestions, so it could never be restored).
     *
     * Ignored when {@linkcode vscode.QuickPickOptions.canPickMany} is `true` (combo box is single-select only).
     */
    readonly createItemFromValue?: (value: string) => TItem | undefined;
}

/**
 * Shows a quick pick with the given items and options.
 *
 * **Key features:**
 *   - If {@linkcode ExtendedQuickPickOptions.isActiveItem} is not provided, the most recently picked item (based
 *     on `label`) will be pre-highlighted. For multi-select, recently picked items will be pre-checked.
 *   - If {@linkcode ExtendedQuickPickOptions.createItemFromValue} is provided, the quick pick acts as a combo box
 *     ("pick or enter"): the user can type a free-form value that is turned into a selectable item.
 *   - If {@linkcode ExtendedQuickPickOptions.showBack} is `true`, a back button will be shown that rejects with
 *     {@linkcode GoBackError} when pressed.
 *   - If the user cancels the quick pick, it rejects with {@linkcode CancellationError}.
 * @param ctx Dependencies ({@linkcode IVsCode} and {@linkcode IExtensionContext})
 * @param items The quick pick items to show
 * @param options Options for the quick pick. See {@linkcode ExtendedQuickPickOptions}.
 */
export function showSmartQuickPick<TItem extends vscode.QuickPickItem>(ctx: ICodeContext, items: TItem[], options: ExtendedQuickPickOptions<TItem> & { canPickMany: true }): Promise<TItem[]>;
export function showSmartQuickPick<TItem extends vscode.QuickPickItem>(ctx: ICodeContext, items: TItem[], options?: ExtendedQuickPickOptions<TItem>): Promise<TItem>;
export function showSmartQuickPick<TItem extends vscode.QuickPickItem>(ctx: ICodeContext, items: TItem[], options?: ExtendedQuickPickOptions<TItem>): Promise<TItem | TItem[]> {
    const showBack = options?.showBack ?? false;
    const quickPick = ctx.code.window.createQuickPick<TItem>();
    const recentKey = quickPickRecentKey(items, options);
    quickPick.items = items;

    if (showBack) {
        quickPick.buttons = [ctx.code.QuickInputButtons.Back];
    }

    // Copy in the options
    quickPick.title = options?.title;
    quickPick.matchOnDescription = !!options?.matchOnDescription;
    quickPick.matchOnDetail = !!options?.matchOnDetail;
    quickPick.placeholder = options?.placeHolder;
    quickPick.ignoreFocusOut = options?.ignoreFocusOut ?? showBack;
    quickPick.canSelectMany = !!options?.canPickMany;
    quickPick.step = options?.step;
    quickPick.totalSteps = options?.totalSteps;
    quickPick.value = options?.value ?? '';
    quickPick.prompt = options?.prompt;

    // Filter items through predicates to safely set active/selected items
    if (options?.isActiveItem) {
        const active = items.find(options.isActiveItem);
        if (active) {
            quickPick.activeItems = [active];
        }
    } else if (!quickPick.canSelectMany) {
        // For single-select, try to pre-highlight a recently chosen item
        const recentLabels = ctx.extensionContext.workspaceState.get<string[]>(recentKey);
        if (recentLabels && recentLabels.length > 0) {
            const recentItem = items.find(item => item.label === recentLabels[0]);
            if (recentItem) {
                recentItem.description = recentItem.description ?
                    ctx.code.l10n.t('{0} (recently selected)', recentItem.description) :
                    ctx.code.l10n.t('(recently selected)');
                quickPick.items = [recentItem, ...items.filter(i => i !== recentItem)];
                quickPick.activeItems = [recentItem];
            }
        }
    }

    if (options?.isSelectedItem) {
        quickPick.selectedItems = items.filter(options.isSelectedItem);
    } else if (quickPick.canSelectMany) {
        // For multi-select, pre-check recently selected items
        const recentLabels = ctx.extensionContext.workspaceState.get<string[]>(recentKey);
        if (recentLabels && recentLabels.length > 0) {
            const recentSet = new Set(recentLabels);
            const recentItems = items.filter(item => recentSet.has(item.label));
            for (const item of recentItems) {
                item.description = item.description ?
                    ctx.code.l10n.t('{0} (recently selected)', item.description) :
                    ctx.code.l10n.t('(recently selected)');
            }
            quickPick.items = [...recentItems, ...items.filter(item => !recentSet.has(item.label))];
            quickPick.selectedItems = recentItems;
        }
    }

    // Combo box ("pick or enter"): when a factory is provided (single-select only),
    // let the user type a free-form value that becomes a selectable item.
    const createItemFromValue = quickPick.canSelectMany ? undefined : options?.createItemFromValue;
    // The synthetic item currently offered for the typed value, if any. Tracked so
    // accepting it does not pollute the "recently picked" memory with an
    // un-restorable label (it is never part of `items`).
    let syntheticItem: TItem | undefined;
    if (createItemFromValue) {
        // Snapshot the current item list and active item (after any recent-item
        // reordering above) so the synthetic item can be prepended/removed
        // without losing the suggestions or the pre-highlighted recent choice.
        const baseItems = quickPick.items;
        const baseActiveItems = quickPick.activeItems;
        const syncItems = (rawValue: string) => {
            const typedItem = createItemFromValue(rawValue.trim());
            // If the typed value resolves to a label that already matches a real
            // suggestion, prefer that suggestion over offering a duplicate
            // synthetic row -- this keeps "pick or enter" from showing two
            // identical-looking entries and lets the accepted choice be remembered.
            const existing = typedItem ? baseItems.find(item => item.label === typedItem.label) : undefined;
            if (typedItem && !existing) {
                syntheticItem = { ...typedItem, alwaysShow: true };
                quickPick.items = [syntheticItem, ...baseItems];
                quickPick.activeItems = [syntheticItem];
            } else {
                syntheticItem = undefined;
                quickPick.items = baseItems;
                // Never leave a stale synthetic item active (accepting it would
                // resolve an entry no longer in `items` and persist its
                // un-restorable label to recents). Activate the matching real
                // suggestion when the typed value duplicated one, otherwise
                // restore the initial active item (e.g. the recent pre-highlight).
                quickPick.activeItems = existing ? [existing] : baseActiveItems;
            }
        };

        // Honor a preset value so a synthetic item is offered before the first keystroke.
        if (quickPick.value) {
            syncItems(quickPick.value);
        }
        quickPick.onDidChangeValue(value => { syncItems(value); });
    }

    const { promise, resolve, reject } = Promise.withResolvers<TItem | TItem[]>();
    let settled = false;
    const finish = (finishAction: () => void) => {
        if (!settled) {
            settled = true;
            quickPick.dispose();
            finishAction();
        }
    };

    quickPick.onDidAccept(() => {
        try {
            if (quickPick.canSelectMany) {
                const selected = [...quickPick.selectedItems];
                if (selected.length > 0) {
                    finish(() => {
                        void ctx.extensionContext.workspaceState.update(recentKey, selected.map(s => s.label));
                        resolve(selected);
                    });
                } else {
                    // If no items are selected, treat it as a cancellation (similar to how hitting escape with no active item doesn't select the active item)
                    finish(() => { reject(new CancellationError(undefined, options?.stepName)); });
                }
            } else {
                const selected = quickPick.activeItems[0] as TItem | undefined;
                if (selected) {
                    finish(() => {
                        // Don't remember a typed/synthesized value: its label is not
                        // one of the suggestions, so it could never be restored and
                        // would clobber a genuinely-pickable recent choice.
                        if (selected !== syntheticItem) {
                            void ctx.extensionContext.workspaceState.update(recentKey, [selected.label]);
                        }
                        resolve(selected);
                    });
                }
            }
        } catch (e: unknown) {
            finish(() => { reject(e); });
        }
    });

    quickPick.onDidTriggerButton((button) => {
        if (button === ctx.code.QuickInputButtons.Back) {
            finish(() => { reject(new GoBackError()); });
        }
    });

    const itemButtonHandler = options?.onDidTriggerItemButton;
    if (itemButtonHandler) {
        quickPick.onDidTriggerItemButton((event) => {
            try {
                itemButtonHandler(event);
            } catch (e: unknown) {
                finish(() => { reject(e); });
            }
        });
    }

    quickPick.onDidHide(() => {
        finish(() => { reject(new CancellationError(undefined, options?.stepName)); });
    });

    quickPick.show();

    return promise;
}

/**
 * Options for input boxes that support a back button, cancellation, and validation
 */
export interface ExtendedInputBoxOptions extends vscode.InputBoxOptions, StepOptions {
    /** A **synchronous** validation function that runs on every keystroke. Should be very fast. */
    validateInput?(value: string): string | vscode.InputBoxValidationMessage | undefined;

    /** An **asynchronous** validation function that runs only when the user accepts. The input is disabled and shows a busy indicator while this runs. */
    validateInputAsync?(value: string): Promise<string | vscode.InputBoxValidationMessage | undefined>;

    /**
     * Value to pre-fill when no recent input is available and no explicit {@link value} is set.
     * Use this instead of {@link value} to allow the recently entered value to take precedence.
     */
    readonly fallbackValue?: string;
}

/**
 * Shows an input box with the given options.
 *
 * **Key features:**
 *   - If {@linkcode ExtendedInputBoxOptions.validateInput} is provided, it runs on every keystroke and shows the
 *     returned `string` (or {@linkcode vscode.InputBoxValidationMessage}) as a validation message if the input is
 *     invalid. Because it runs on every keystroke, it needs to be very fast.
 *   - If {@linkcode ExtendedInputBoxOptions.validateInputAsync} is provided, it runs when the user accepts. The
 *     input box is disabled and shows a busy indicator while the promise is pending. If the promise resolves
 *     to a `string` (or {@linkcode vscode.InputBoxValidationMessage}), it is shown as a validation message and the
 *     input box is re-enabled. If the promise resolves to `undefined`, the input is accepted. If the promise
 *     rejects, the error is propagated.
 *   - If {@linkcode ExtendedInputBoxOptions.showBack} is `true`, a back button will be shown that rejects with
 *     {@linkcode GoBackError} when pressed.
 *   - If the user cancels the input box, it rejects with {@linkcode CancellationError}.
 * @param ctx Dependencies ({@linkcode IVsCode} and {@linkcode IExtensionContext})
 * @param options Options for the input box. See {@linkcode ExtendedInputBoxOptions}.
 */
export function showSmartInputBox(ctx: ICodeContext, options?: ExtendedInputBoxOptions): Promise<string> {
    const showBack = options?.showBack ?? false;
    const input = ctx.code.window.createInputBox();
    const recentKey = options ? inputBoxRecentKey(options) : undefined;

    if (showBack) {
        input.buttons = [ctx.code.QuickInputButtons.Back];
    }

    // Copy in the options
    input.title = options?.title;
    input.value = options?.value ?? '';
    input.valueSelection = options?.valueSelection;
    input.prompt = options?.prompt;
    input.placeholder = options?.placeHolder;
    input.password = !!options?.password;
    input.ignoreFocusOut = options?.ignoreFocusOut ?? showBack;
    input.step = options?.step;
    input.totalSteps = options?.totalSteps;

    // If the caller did not provide a default value, try to pre-fill based on recent input
    if (recentKey && options?.value === undefined) {
        const recentValue = ctx.extensionContext.workspaceState.get<string>(recentKey);
        if (recentValue) {
            input.value = recentValue;
        } else if (options?.fallbackValue !== undefined) {
            input.value = options.fallbackValue;
        }
    }

    const { promise, resolve, reject } = Promise.withResolvers<string>();
    let settled = false;
    const finish = (finishAction: () => void) => {
        if (!settled) {
            settled = true;
            input.dispose();
            finishAction();
        }
    };

    input.onDidAccept(() => {
        try {
            const value = input.value;

            // Run sync validation first
            if (options?.validateInput) {
                const syncMsg = options.validateInput(value);
                if (syncMsg) {
                    input.validationMessage = syncMsg;
                    return;
                }
            }

            // Run async validation if provided
            if (options?.validateInputAsync) {
                input.enabled = false;
                input.busy = true;
                options.validateInputAsync(value).then((msg) => {
                    if (!settled) {
                        input.enabled = true;
                        input.busy = false;
                        if (msg) {
                            input.validationMessage = msg;
                        } else {
                            finish(() => {
                                if (recentKey) {
                                    void ctx.extensionContext.workspaceState.update(recentKey, value);
                                }
                                resolve(value);
                            });
                        }
                    }
                }, (e: unknown) => {
                    finish(() => { reject(e); });
                });
                return;
            }

            finish(() => {
                if (recentKey) {
                    void ctx.extensionContext.workspaceState.update(recentKey, value);
                }
                resolve(value);
            });
        } catch (e: unknown) {
            finish(() => { reject(e); });
        }
    });

    input.onDidChangeValue((value) => {
        try {
            // Run sync validation on every keystroke
            if (options?.validateInput) {
                input.validationMessage = options.validateInput(value);
            } else {
                input.validationMessage = undefined;
            }
        } catch (e: unknown) {
            finish(() => { reject(e); });
        }
    });

    input.onDidTriggerButton((button) => {
        if (button === ctx.code.QuickInputButtons.Back) {
            finish(() => { reject(new GoBackError()); });
        }
    });

    input.onDidHide(() => {
        finish(() => { reject(new CancellationError(undefined, options?.stepName)); });
    });

    input.show();

    return promise;
}

/**
 * Options related to quick picks / inputs with steps and back buttons
 */
interface StepOptions {
    /** Optional name of the step (used in {@linkcode CancellationError}'s `stepName`) */
    readonly stepName?: string;

    /** Optional current step number */
    readonly step?: number;

    /** Optional total number of steps */
    readonly totalSteps?: number;

    /** When `true`, shows a back button that throws {@linkcode GoBackError} when pressed. Defaults to `false`. */
    readonly showBack?: boolean;
}

function quickPickRecentKey<TItem extends vscode.QuickPickItem>(items: TItem[], options: ExtendedQuickPickOptions<TItem> | undefined): string {
    const hash = crypto.createHash('sha256');
    // Sort a copy to avoid mutating the caller's array.
    // Intentionally excludes `description` -- it may be mutated by the recently-selected label.
    for (const item of [...items].sort((a, b) => a.label.localeCompare(b.label))) {
        hash.update(item.label);
        hash.update('|');
    }
    hash.update(options?.stepName ?? options?.title ?? '');
    return `recentChoice:${hash.digest('hex')}`;
}

function inputBoxRecentKey(options: ExtendedInputBoxOptions): string {
    const hash = crypto.createHash('sha256');
    hash.update(options.title ?? '');
    hash.update(options.prompt ?? '');
    hash.update(options.placeHolder ?? '');
    hash.update(options.stepName ?? '');
    return `recentInput:${hash.digest('hex')}`;
}

const Pending: unique symbol = Symbol('Pending');

/**
 * Returns the single workspace folder, or prompts the user to pick one
 * when multiple folders are open.
 *
 * - Returns `undefined` when no workspace folders are open (nothing to pick).
 * - Returns the single folder when exactly one is open (no prompt).
 * - Prompts when multiple are open and returns the chosen folder.
 * - Throws {@linkcode CancellationError} when the user dismisses the picker,
 *   matching {@linkcode showSmartQuickPick} / {@linkcode showSmartInputBox}
 *   so callers can rely on the same cancellation contract.
 */
export async function getWorkspaceFolder(code: IVsCode, placeHolder?: string): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = code.workspace.workspaceFolders;
    if (!folders?.length) {
        return undefined;
    } else if (folders.length === 1) {
        return folders[0];
    }

    const picked = await code.window.showWorkspaceFolderPick({ placeHolder });
    if (!picked) {
        throw new CancellationError();
    }
    return picked;
}

/**
 * Awaits a promise, showing a progress notification only if it doesn't
 * resolve within `ms` milliseconds. Avoids a brief flash of the
 * notification when the operation completes instantly (e.g. cache hit).
 *
 * @param code - The VS Code API surface.
 * @param options - Progress options forwarded to `window.withProgress`.
 * @param promise - The promise to await.
 * @param ms - Milliseconds to wait before showing the notification. Defaults to 150.
 */
export async function withDelayedProgress<T>(code: IVsCode, options: vscode.ProgressOptions, promise: Promise<T>, ms = 150): Promise<T> {
    const raceResult = await Promise.race([
        promise,
        delay(ms).then((): typeof Pending => Pending),
    ]);

    if (raceResult !== Pending) {
        return raceResult;
    }

    return code.window.withProgress(options, () => { return promise; });
}
