/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from '@microsoft/vscode-azure-utils';
import { LogStreamTerminal } from '../../utils/logStream/LogStreamTerminal';

/** Starts its owned process when the task opens, and closes the task when that process exits. */
export class FunctionsHostTerminal extends LogStreamTerminal {
    private readonly exit = new EventEmitter<number>();
    private started = false;
    private hostClosed = false;
    private exitCode?: number;
    public readonly onDidClose = this.exit.event;

    public constructor(private readonly start: () => void, cancel: () => void) { super(cancel); }

    public override open(): void {
        super.open();
        if (!this.started && !this.hostClosed) {
            this.started = true;
            if (this.exitCode !== undefined) {
                this.finish(this.exitCode);
            } else {
                this.start();
            }
        }
    }

    /** Ends the task after buffered output is delivered when its terminal opens. */
    public finish(code: number): void {
        if (!this.hostClosed) {
            this.exitCode ??= code;
            if (this.started) {
                this.exit.fire(this.exitCode);
                this.close();
            }
        }
    }

    public override close(): void {
        if (this.hostClosed) { return; }
        this.hostClosed = true;
        super.close();
        this.exit.dispose();
    }
}
