/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';
import { format } from 'util';
import type * as vscode from 'vscode';
import { Disposable } from './Disposable';
import type { IVsCode } from './IVsCode';

export const IOutputChannel: ServiceIdentifier<IOutputChannel> = Symbol.for('OutputChannel');
export type IOutputChannel = vscode.LogOutputChannel; // TODO: subset to what we actually use for easier mocking?

export function createOutputChannel(
    name: string,
    code: IVsCode
): IOutputChannel {
    const debugOutputChannel = process.env.VSCODE_RUNNING_TESTS?.toLowerCase();

    if (debugOutputChannel === '1') {
        return new DebugOutputChannel(name);
    }

    return code.window.createOutputChannel(name, { log: true });
}

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
export class DebugOutputChannel implements IOutputChannel {
    constructor(public readonly name: string) { }

    public readonly logLevel = 1; // vscode.LogLevel.Trace; // Avoiding the actual enum value to prevent a dependency on vscode, plus this is just a debug channel

    public readonly onDidChangeLogLevel = () => { return Disposable.None; };

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
        const message = error instanceof Error ? error.message : error;
        this.appendLine(`[ERROR] ${format(message, ...args)}`);
    }

    public append(value: string): void {
        console.log(`${this.name}: ${value}`);
    }

    public appendLine(value: string): void {
        console.log(`${this.name}: ${value}`); // console.log adds a newline
    }

    public replace(value: string): void {
        // noop
    }

    public clear(): void {
        // noop
    }

    public show(column?: unknown, preserveFocus?: unknown): void {
        // noop
    }

    public hide(): void {
        // noop
    }

    public dispose(): void {
        // noop
    }
}
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
