/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

/** Lifecycle callbacks for a {@linkcode BufferedPseudoterminal}; each runs at most once. */
export interface BufferedPseudoterminalOptions {
    /** Runs after VS Code opens the terminal and buffered output is delivered, unless the terminal already closed. */
    readonly onOpen?: () => void;
    /** Runs when the terminal closes, whether VS Code closed it or {@linkcode BufferedPseudoterminal.finish} ended it. */
    readonly onClose: () => void;
}

/**
 * A pseudoterminal that buffers output until VS Code opens it, and defers an exit code
 * until that buffered output has been delivered.
 */
export class BufferedPseudoterminal implements vscode.Pseudoterminal {
    private readonly writeEmitter = new EventEmitter<string>();
    private readonly exitEmitter = new EventEmitter<number>();
    private readonly pending: string[] = [];
    private opened = false;
    private closed = false;
    private exitCode?: number;
    private lastWasCarriageReturn = false;

    public readonly onDidWrite = this.writeEmitter.event;
    public readonly onDidClose = this.exitEmitter.event;

    public constructor(private readonly options: BufferedPseudoterminalOptions) { }

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
        // A listener can close the terminal while buffered output is delivered, which control-flow narrowing cannot see.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        } else if (!this.closed) {
            this.options.onOpen?.();
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
        this.options.onClose();
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
