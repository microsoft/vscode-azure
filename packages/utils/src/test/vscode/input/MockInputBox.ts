/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { EventEmitter } from '../../../vscode/EventEmitter';

/**
 * A controllable mock of `vscode.InputBox`.
 *
 * Production code interacts with this through the standard InputBox
 * properties and events. Tests drive user interactions through the
 * helper methods: {@linkcode accept}, {@linkcode pressButton}, {@linkcode triggerHide},
 * and {@linkcode changeValue}.
 */
export class MockInputBox implements vscode.InputBox {
    // #region Properties
    value = '';
    valueSelection: readonly [number, number] | undefined;
    placeholder: string | undefined;
    password = false;
    buttons: readonly vscode.QuickInputButton[] = [];
    title: string | undefined;
    prompt: string | undefined;
    validationMessage: string | vscode.InputBoxValidationMessage | undefined;
    enabled = true;
    busy = false;
    ignoreFocusOut = false;
    step: number | undefined;
    totalSteps: number | undefined;
    // #endregion

    // #region Internal emitters
    private readonly _onDidAccept = new EventEmitter<void>();
    private readonly _onDidHide = new EventEmitter<void>();
    private readonly _onDidTriggerButton = new EventEmitter<vscode.QuickInputButton>();
    private readonly _onDidChangeValue = new EventEmitter<string>();
    // #endregion

    // #region Event subscriptions
    readonly onDidAccept = this._onDidAccept.event;
    readonly onDidHide = this._onDidHide.event;
    readonly onDidTriggerButton = this._onDidTriggerButton.event;
    readonly onDidChangeValue = this._onDidChangeValue.event;
    // #endregion

    // #region Tracked methods
    readonly show = mock.fn(noop);
    readonly hide = mock.fn(noop);
    readonly dispose = mock.fn(noop);
    // #endregion

    // #region Test helpers

    /** Simulate the user pressing Enter / accepting the current value. */
    accept(): void {
        this._onDidAccept.fire(undefined);
    }

    /** Simulate the user pressing a button (e.g. Back). */
    pressButton(button: vscode.QuickInputButton): void {
        this._onDidTriggerButton.fire(button);
    }

    /** Simulate the input box being hidden. */
    triggerHide(): void {
        this._onDidHide.fire(undefined);
    }

    /** Simulate the user typing a new value. */
    changeValue(newValue: string): void {
        this.value = newValue;
        this._onDidChangeValue.fire(newValue);
    }
    // #endregion
}

const noop = () => { /* noop */ };
