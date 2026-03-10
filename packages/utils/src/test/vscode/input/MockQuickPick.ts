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
 * helper methods: {@link accept}, {@link pressButton}, {@link triggerHide},
 * and {@link changeValue}.
 */
export class MockQuickPick<T extends vscode.QuickPickItem> implements vscode.QuickPick<T> {
    // ── Properties (set by production code) ─────────────────
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

    // ── Internal emitters ───────────────────────────────────
    private readonly _onDidAccept = new EventEmitter<void>();
    private readonly _onDidHide = new EventEmitter<void>();
    private readonly _onDidTriggerButton = new EventEmitter<vscode.QuickInputButton>();
    private readonly _onDidTriggerItemButton = new EventEmitter<vscode.QuickPickItemButtonEvent<T>>();
    private readonly _onDidChangeValue = new EventEmitter<string>();
    private readonly _onDidChangeActive = new EventEmitter<readonly T[]>();
    private readonly _onDidChangeSelection = new EventEmitter<readonly T[]>();

    // ── Event subscriptions (used by production code) ───────
    readonly onDidAccept = this._onDidAccept.event;
    readonly onDidHide = this._onDidHide.event;
    readonly onDidTriggerButton = this._onDidTriggerButton.event;
    readonly onDidTriggerItemButton = this._onDidTriggerItemButton.event;
    readonly onDidChangeValue = this._onDidChangeValue.event;
    readonly onDidChangeActive = this._onDidChangeActive.event;
    readonly onDidChangeSelection = this._onDidChangeSelection.event;

    // ── Tracked methods ─────────────────────────────────────
    readonly show = mock.fn(noop);
    readonly hide = mock.fn(noop);
    readonly dispose = mock.fn(noop);

    // ── Test helpers ────────────────────────────────────────

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
    }
}

const noop = () => { /* noop */ };
