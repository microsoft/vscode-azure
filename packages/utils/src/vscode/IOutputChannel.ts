/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';
import { format } from 'util';
import type * as vscode from 'vscode';
import { stringifyError } from '../base/stringifyError';
import type { Disposable } from './Disposable';
import { EventEmitter } from './EventEmitter';
import type { IVsCode } from './IVsCode';

export const IOutputChannel: ServiceIdentifier<IOutputChannel> = Symbol.for('OutputChannel');
/** The extension's output channel. Currently aliased to VS Code's `LogOutputChannel`. */
export type IOutputChannel = vscode.LogOutputChannel & Disposable;

/**
 * Create an {@linkcode IOutputChannel} for the given name.
 *
 * When running under tests (`VSCODE_RUNNING_TESTS=1`), returns a
 * {@linkcode DebugOutputChannel} that writes to `console.log` instead
 * of calling into the VS Code window API.
 */
export function createOutputChannel(
    name: string,
    code: IVsCode
): IOutputChannel {
    /* c8 ignore next 4 */
    const debugOutputChannel = process.env.VSCODE_RUNNING_TESTS?.toLowerCase();
    if (debugOutputChannel === '1') {
        return new DebugOutputChannel(name);
    }

    return code.window.createOutputChannel(name, { log: true });
}

/* c8 ignore start */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
/**
 * Test/debug {@linkcode IOutputChannel} that routes all log calls to
 * `console.log`. Used when `VSCODE_RUNNING_TESTS` is set so that
 * output produced by product code is visible in the test runner.
 */
export class DebugOutputChannel implements IOutputChannel {
    constructor(public readonly name: string) { }

    /**
     * Current log level. Assigning to this setter also fires
     * {@linkcode onDidChangeLogLevel}, so tests can simulate the user changing
     * the level from the Output panel gear menu via `output.logLevel = ...`.
     */
    public get logLevel(): vscode.LogLevel { return this._logLevel; }
    public set logLevel(level: vscode.LogLevel) {
        this._logLevel = level;
        this.logLevelEmitter.fire(level);
    }
    private _logLevel: vscode.LogLevel = 1 satisfies vscode.LogLevel; // Avoiding the actual enum value to prevent a dependency on vscode, plus this is just a debug channel

    private readonly logLevelEmitter = new EventEmitter<vscode.LogLevel>();

    public readonly onDidChangeLogLevel = this.logLevelEmitter.event;

    public trace(message: string, ...args: any[]): void {
        this.appendLine(`[TRACE] ${format(message, ...args)}`);
    }

    public debug(message: string, ...args: any[]): void {
        this.appendLine(`[DEBUG] ${format(message, ...args)}`);
    }

    public info(message: string, ...args: any[]): void {
        this.appendLine(`[INFO] ${format(message, ...args)}`);
    }

    public warn(message: string, ...args: any[]): void {
        this.appendLine(`[WARN] ${format(message, ...args)}`);
    }

    public error(error: string | Error, ...args: any[]): void {
        const message = stringifyError(error);
        this.appendLine(`[ERROR] ${format(message, ...args)}`);
    }

    public append(value: string): void {
        console.log(`${this.name}: ${value}`);
    }

    public appendLine(value: string): void {
        console.log(`${this.name}: ${value}`); // console.log adds a newline
    }

    public replace = noop;
    public clear = noop;
    public show = noop;
    public hide = noop;

    public dispose(): void {
        this.logLevelEmitter.dispose();
    }
}
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */

const noop = () => { /* noop */ };
/* c8 ignore stop */
