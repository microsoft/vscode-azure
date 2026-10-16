/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

/** Buffers output until VS Code opens the terminal; closure cancels its associated stream. */
export class LogStreamTerminal implements vscode.Pseudoterminal {
    private readonly writeEmitter = new EventEmitter<string>();
    private readonly exitEmitter = new EventEmitter<number>();
    private readonly pending: string[] = [];
    private opened = false;
    /** Subclasses must not start work after closure or a reported exit. */
    protected closed = false;
    private exitCode?: number;
    private lastWasCarriageReturn = false;

    public readonly onDidWrite = this.writeEmitter.event;
    public readonly onDidClose = this.exitEmitter.event;

    public constructor(private readonly onClose: () => void) { }

    /** @inheritdoc */
    public open(): void {
        if (this.closed || this.opened) {
            return;
        }
        this.opened = true;
        for (const text of this.pending) {
            this.writeEmitter.fire(text);
        }
        this.pending.length = 0;
        if (this.exitCode !== undefined) {
            this.finish(this.exitCode);
        }
    }

    /** Ends the terminal after buffered output is delivered, retaining its nonzero-exit diagnostics. */
    public finish(code: number): void {
        if (this.closed) {
            return;
        }
        this.exitCode ??= code;
        if (this.opened) {
            this.exitEmitter.fire(this.exitCode);
            this.close();
        }
    }

    /** @inheritdoc */
    public close(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.pending.length = 0;
        this.onClose();
        this.writeEmitter.dispose();
        this.exitEmitter.dispose();
    }

    /** Writes stream text using CRLF line endings, including when a CRLF spans two chunks. */
    public write(value: string): void {
        if (!this.closed && value) {
            const text = value.replace(/\r?\n/g, (match: string, offset: number) =>
                offset === 0 && match === '\n' && this.lastWasCarriageReturn ? '\n' : '\r\n');
            this.lastWasCarriageReturn = value.endsWith('\r');
            if (this.opened) {
                this.writeEmitter.fire(text);
            } else {
                this.pending.push(text);
            }
        }
    }
}
