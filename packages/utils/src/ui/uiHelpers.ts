/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import type * as vscode from 'vscode';
import { CancellationError } from '../vscode/CancellationError';
import type { IExtensionContext } from '../vscode/IExtensionContext';
import type { IVsCode } from '../vscode/IVsCode';
import { GoBackError } from '../wizard/GoBackError';

/** A {@link vscode.QuickPickItem} with associated underlying data */
export interface QuickPickItemWithData<T> extends vscode.QuickPickItem {
    readonly data: T;
}

/** Options for quick pick boxes that support a back button, cancellation, and preset values */
export interface ExtendedQuickPickOptions extends vscode.QuickPickOptions, StepOptions {
    /** Predicate to determine which item should be pre-highlighted. The first matching item wins. */
    readonly isActiveItem?: (item: vscode.QuickPickItem) => boolean;

    /** Predicate to determine which items are pre-selected when {@link vscode.QuickPickOptions.canPickMany} is true. */
    readonly isSelectedItem?: (item: vscode.QuickPickItem) => boolean;

    /** Preset filter string */
    readonly value?: string;

    /** Called when a button on a specific quick pick item is triggered. */
    readonly onDidTriggerItemButton?: (event: vscode.QuickPickItemButtonEvent<vscode.QuickPickItem>) => void;
}

export function showSmartQuickPick<TItem extends vscode.QuickPickItem>(injected: Injected, items: TItem[], options: ExtendedQuickPickOptions & { canPickMany: true }): Promise<TItem[]>;
export function showSmartQuickPick<TItem extends vscode.QuickPickItem>(injected: Injected, items: TItem[], options?: ExtendedQuickPickOptions): Promise<TItem>;
export function showSmartQuickPick<TItem extends vscode.QuickPickItem>(injected: Injected, items: TItem[], options?: ExtendedQuickPickOptions): Promise<TItem | TItem[]> {
    const showBack = options?.showBack ?? false;
    const quickPick = injected.code.window.createQuickPick<vscode.QuickPickItem>();
    const recentKey = quickPickRecentKey(items, options);
    quickPick.items = items;

    if (showBack) {
        quickPick.buttons = [injected.code.QuickInputButtons.Back];
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
        const recentLabels = injected.context.workspaceState.get<string[]>(recentKey);
        if (recentLabels && recentLabels.length > 0) {
            const recentItem = items.find(item => item.label === recentLabels[0]);
            if (recentItem) {
                recentItem.description = recentItem.description ?
                    injected.code.l10n.t('{0} (recently selected)', recentItem.description) :
                    injected.code.l10n.t('(recently selected)');
                quickPick.activeItems = [recentItem];
            }
        }
    }

    if (options?.isSelectedItem) {
        quickPick.selectedItems = items.filter(options.isSelectedItem);
    } else if (quickPick.canSelectMany) {
        // For multi-select, pre-check recently selected items
        const recentLabels = injected.context.workspaceState.get<string[]>(recentKey);
        if (recentLabels && recentLabels.length > 0) {
            const recentSet = new Set(recentLabels);
            const recentItems = items.filter(item => recentSet.has(item.label));
            for (const item of recentItems) {
                item.description = item.description ?
                    injected.code.l10n.t('{0} (recently selected)', item.description) :
                    injected.code.l10n.t('(recently selected)');
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
                            void injected.context.workspaceState.update(recentKey, selected.map(s => s.label));
                            resolve(selected as TItem[]);
                        });
                    }
                } else {
                    const selected = quickPick.activeItems[0] as vscode.QuickPickItem | undefined;
                    if (selected) {
                        finish(() => {
                            void injected.context.workspaceState.update(recentKey, [selected.label]);
                            resolve(selected as TItem);
                        });
                    }
                }
            } catch (e: unknown) {
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                finish(() => { reject(e); });
            }
        });

        quickPick.onDidTriggerButton((button) => {
            if (button === injected.code.QuickInputButtons.Back) {
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

export function showSmartInputBox(injected: Injected, options?: ExtendedInputBoxOptions): Promise<string> {
    const showBack = options?.showBack ?? false;
    const input = injected.code.window.createInputBox();
    const recentKey = options ? inputBoxRecentKey(options) : undefined;

    if (showBack) {
        input.buttons = [injected.code.QuickInputButtons.Back];
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
    if (recentKey && !options?.value) {
        const recentValue = injected.context.workspaceState.get<string>(recentKey);
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
                        input.enabled = true;
                        input.busy = false;
                        if (msg) {
                            input.validationMessage = msg;
                        } else {
                            finish(() => {
                                if (recentKey) {
                                    void injected.context.workspaceState.update(recentKey, value);
                                }
                                resolve(value);
                            });
                        }
                    }, (e: unknown) => {
                        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                        finish(() => { reject(e); });
                    });
                    return;
                }

                finish(() => {
                    if (recentKey) {
                        void injected.context.workspaceState.update(recentKey, value);
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
            if (button === injected.code.QuickInputButtons.Back) {
                finish(() => { reject(new GoBackError()); });
            }
        });

        input.onDidHide(() => {
            finish(() => { reject(new CancellationError(undefined, options?.stepName)); });
        });

        input.show();
    });
}

interface Injected {
    readonly code: IVsCode;
    readonly context: IExtensionContext;
}

interface StepOptions {
    readonly stepName?: string;
    readonly step?: number;
    readonly totalSteps?: number;

    /** When `true`, shows a back button that throws {@link GoBackError} when pressed. Defaults to `false`. */
    readonly showBack?: boolean;
}

function quickPickRecentKey(items: vscode.QuickPickItem[], options: ExtendedQuickPickOptions | undefined): string {
    const hash = crypto.createHash('sha256');
    // Sort a copy to avoid mutating the caller's array.
    for (const item of [...items].sort((a, b) => a.label.localeCompare(b.label))) {
        hash.update(item.label);
        hash.update(item.description ?? '');
        hash.update('|');
    }
    hash.update(options?.title ?? options?.stepName ?? '');
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
