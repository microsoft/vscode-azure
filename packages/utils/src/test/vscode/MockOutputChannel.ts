/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { EventEmitter } from '../../vscode/EventEmitter';
import type { IOutputChannel } from '../../vscode/IOutputChannel';

/**
 * Silent {@linkcode IOutputChannel} whose methods are `mock.fn()` no-ops.
 *
 * Used as the default in tests to keep test runner output clean while
 * still allowing call-count assertions when needed.
 * Switch to {@linkcode DebugOutputChannel} when you need to see
 * what product code is logging.
 */
export class MockOutputChannel implements IOutputChannel {
    constructor(public readonly name: string) { }

    public get logLevel(): vscode.LogLevel { return this._logLevel; }
    public set logLevel(level: vscode.LogLevel) {
        this._logLevel = level;
        this.logLevelEmitter.fire(level);
    }
    private _logLevel: vscode.LogLevel = 1 satisfies vscode.LogLevel;

    private readonly logLevelEmitter = new EventEmitter<vscode.LogLevel>();
    public readonly onDidChangeLogLevel = this.logLevelEmitter.event;

    public readonly trace = mock.fn();
    public readonly debug = mock.fn();
    public readonly info = mock.fn();
    public readonly warn = mock.fn();
    public readonly error = mock.fn();
    public readonly append = mock.fn();
    public readonly appendLine = mock.fn();
    public readonly replace = mock.fn();
    public readonly clear = mock.fn();
    public readonly show = mock.fn();
    public readonly hide = mock.fn();

    public dispose(): void {
        this.logLevelEmitter.dispose();
    }
}
