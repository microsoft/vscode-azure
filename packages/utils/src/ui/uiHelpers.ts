/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import type * as vscode from 'vscode';
import { CancellationError } from '../vscode/CancellationError';
import type { ICodeContext } from '../vscode/IVsCode';
import { GoBackError } from '../wizard/GoBackError';

/** A {@link vscode.QuickPickItem} with associated underlying data */
export interface QuickPickItemWithData<T> extends vscode.QuickPickItem {
    readonly data: T;
}

/** Options for quick pick boxes that support a back button, cancellation, and preset values */
export interface ExtendedQuickPickOptions<TItem extends vscode.QuickPickItem> extends vscode.QuickPickOptions, StepOptions {
    /** Predicate to determine which item should be pre-highlighted. The first matching item wins. */
    readonly isActiveItem?: (item: TItem) => boolean;

    /** Predicate to determine which items are pre-selected when {@link vscode.QuickPickOptions.canPickMany} is true. */
    readonly isSelectedItem?: (item: TItem) => boolean;

    /** Preset filter string */
    readonly value?: string;

    /** Called when a button on a specific quick pick item is triggered. */
    readonly onDidTriggerItemButton?: (event: vscode.QuickPickItemButtonEvent<TItem>) => void;
}

/**
 * Shows a quick pick with the given items and options.
 *
 * **Key features:**
 *   - If {@link ExtendedQuickPickOptions.isActiveItem} is not provided, the most recently picked item (based
 *     on `label`) will be pre-highlighted. For multi-select, recently picked items will be pre-checked.
 *   - If {@link ExtendedQuickPickOptions.showBack} is `true`, a back button will be shown that rejects with
 *     {@link GoBackError} when pressed.
 *   - If the user cancels the quick pick, it rejects with {@link CancellationError}.
 * @param ctx Dependencies ({@link IVsCode} and {@link IExtensionContext})
 * @param items The quick pick items to show
 * @param options Options for the quick pick. See {@link ExtendedQuickPickOptions}.
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
            quickPick.selectedItems = recentItems;
        }
    }

    return new Promise<TItem | TItem[]>((resolve, reject) => {
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
                            void ctx.extensionContext.workspaceState.update(recentKey, [selected.label]);
                            resolve(selected);
                        });
                    }
                }
            } catch (e: unknown) {
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
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
                    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                    finish(() => { reject(e); });
                }
            });
        }

        quickPick.onDidHide(() => {
            finish(() => { reject(new CancellationError(undefined, options?.stepName)); });
        });

        quickPick.show();
    });
}

/**
 * Options for input boxes that support a back button, cancellation, and validation
 */
export interface ExtendedInputBoxOptions extends vscode.InputBoxOptions, StepOptions {
    /** A **synchronous** validation function that runs on every keystroke. Should be very fast. */
    validateInput?(value: string): string | vscode.InputBoxValidationMessage | undefined;

    /** An **asynchronous** validation function that runs only when the user accepts. The input is disabled and shows a busy indicator while this runs. */
    validateInputAsync?(value: string): Promise<string | vscode.InputBoxValidationMessage | undefined>;
}

/**
 * Shows an input box with the given options.
 *
 * **Key features:**
 *   - If {@link ExtendedInputBoxOptions.validateInput} is provided, it runs on every keystroke and shows the
 *     returned `string` (or {@link vscode.InputBoxValidationMessage}) as a validation message if the input is
 *     invalid. Because it runs on every keystroke, it needs to be very fast.
 *   - If {@link ExtendedInputBoxOptions.validateInputAsync} is provided, it runs when the user accepts. The
 *     input box is disabled and shows a busy indicator while the promise is pending. If the promise resolves
 *     to a `string` (or {@link vscode.InputBoxValidationMessage}), it is shown as a validation message and the
 *     input box is re-enabled. If the promise resolves to `undefined`, the input is accepted. If the promise
 *     rejects, the error is propagated.
 *   - If {@link ExtendedInputBoxOptions.showBack} is `true`, a back button will be shown that rejects with
 *     {@link GoBackError} when pressed.
 *   - If the user cancels the input box, it rejects with {@link CancellationError}.
 * @param ctx Dependencies ({@link IVsCode} and {@link IExtensionContext})
 * @param options Options for the input box. See {@link ExtendedInputBoxOptions}.
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
        }
    }

    return new Promise<string>((resolve, reject) => {
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
                        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
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
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
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
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
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
    });
}

/**
 * Options related to quick picks / inputs with steps and back buttons
 */
interface StepOptions {
    /** Optional name of the step (used in {@link CancellationError}'s `stepName`) */
    readonly stepName?: string;

    /** Optional current step number */
    readonly step?: number;

    /** Optional total number of steps */
    readonly totalSteps?: number;

    /** When `true`, shows a back button that throws {@link GoBackError} when pressed. Defaults to `false`. */
    readonly showBack?: boolean;
}

function quickPickRecentKey<TItem extends vscode.QuickPickItem>(items: TItem[], options: ExtendedQuickPickOptions<TItem> | undefined): string {
    const hash = crypto.createHash('sha256');
    // Sort a copy to avoid mutating the caller's array.
    for (const item of [...items].sort((a, b) => a.label.localeCompare(b.label))) {
        hash.update(item.label);
        hash.update(item.description ?? '');
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
