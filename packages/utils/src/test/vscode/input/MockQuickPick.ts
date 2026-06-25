/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { EventEmitter } from '../../../vscode/EventEmitter';

/**
 * A controllable mock of `vscode.QuickPick<T>`.
 *
 * Production code interacts with this through the standard QuickPick
 * properties and events. Tests drive user interactions through the
 * helper methods: {@linkcode accept}, {@linkcode pressButton}, {@linkcode triggerHide},
 * and {@linkcode changeValue}.
 */
export class MockQuickPick<T extends vscode.QuickPickItem> implements vscode.QuickPick<T> {
    // #region Properties (set by production code)
    items: readonly T[] = [];
    activeItems: readonly T[] = [];
    selectedItems: readonly T[] = [];
    buttons: readonly vscode.QuickInputButton[] = [];
    title: string | undefined;
    placeholder: string | undefined;
    value = '';
    matchOnDescription = false;
    matchOnDetail = false;
    canSelectMany = false;
    ignoreFocusOut = false;
    enabled = true;
    busy = false;
    step: number | undefined;
    totalSteps: number | undefined;
    keepScrollPosition?: boolean;
    prompt: string | undefined;
    // #endregion

    // #region Internal emitters
    private readonly _onDidAccept = new EventEmitter<void>();
    private readonly _onDidHide = new EventEmitter<void>();
    private readonly _onDidTriggerButton = new EventEmitter<vscode.QuickInputButton>();
    private readonly _onDidTriggerItemButton = new EventEmitter<vscode.QuickPickItemButtonEvent<T>>();
    private readonly _onDidChangeValue = new EventEmitter<string>();
    private readonly _onDidChangeActive = new EventEmitter<readonly T[]>();
    private readonly _onDidChangeSelection = new EventEmitter<readonly T[]>();
    // #endregion

    // #region Event subscriptions (used by production code)
    readonly onDidAccept = this._onDidAccept.event;
    readonly onDidHide = this._onDidHide.event;
    readonly onDidTriggerButton = this._onDidTriggerButton.event;
    readonly onDidTriggerItemButton = this._onDidTriggerItemButton.event;
    readonly onDidChangeValue = this._onDidChangeValue.event;
    readonly onDidChangeActive = this._onDidChangeActive.event;
    readonly onDidChangeSelection = this._onDidChangeSelection.event;
    // #endregion

    // #region Tracked methods
    readonly show = mock.fn(noop);
    readonly hide = mock.fn(noop);
    readonly dispose = mock.fn(noop);
    // #endregion

    // #region Test helpers

    /** Simulate the user accepting the current selection. */
    accept(): void {
        this._onDidAccept.fire();
    }

    /** Simulate the user pressing a button (e.g. Back). */
    pressButton(button: vscode.QuickInputButton): void {
        this._onDidTriggerButton.fire(button);
    }

    /** Simulate the user pressing a button on a specific item. */
    pressItemButton(item: T, button: vscode.QuickInputButton): void {
        this._onDidTriggerItemButton.fire({ item, button });
    }

    /** Simulate the quick pick being hidden (e.g. focus lost). */
    triggerHide(): void {
        this._onDidHide.fire();
    }

    /** Simulate the user typing a filter value. */
    changeValue(newValue: string): void {
        this.value = newValue;
        this._onDidChangeValue.fire(newValue);
        // Simulate VS Code: after the value changes (and production updates
        // `items` in its onDidChangeValue handler) the first *visible* item
        // becomes active. This is a simplified stand-in for VS Code's fuzzy
        // filtering -- enough to exercise combo-box ("pick or enter") behavior,
        // where a real suggestion matching the typed value should take
        // precedence over an always-shown synthetic fallback.
        this.activeItems = this.computeActiveItems();
    }

    /**
     * Pick the first item that would be visible for the current {@linkcode value}:
     * any {@linkcode vscode.QuickPickItem.alwaysShow alwaysShow} item, or one whose
     * label -- or description, when {@linkcode matchOnDescription} is set --
     * contains the value (case-insensitively). Returns an empty array when nothing
     * is visible.
     */
    private computeActiveItems(): readonly T[] {
        const needle = this.value.trim().toLowerCase();
        const isVisible = (item: T): boolean => {
            if (item.alwaysShow || needle === '') {
                return true;
            }
            if (item.label.toLowerCase().includes(needle)) {
                return true;
            }
            return this.matchOnDescription && (item.description?.toLowerCase().includes(needle) ?? false);
        };
        const first = this.items.find(isVisible);
        return first ? [first] : [];
    }
    // #endregion
}

const noop = () => { /* noop */ };
