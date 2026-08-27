/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { EventEmitter } from '../../src/vscode/EventEmitter';

/**
 * A {@linkcode vscode.CancellationToken CancellationToken} a test can trip.
 *
 * VS Code's own `CancellationTokenSource` is unavailable in unit tests, and the
 * shape is small enough that a real emitter is simpler than a mock.
 */
export class MockCancellationToken implements vscode.CancellationToken {
    private readonly emitter = new EventEmitter<void>();

    public isCancellationRequested = false;

    public readonly onCancellationRequested: vscode.Event<void> = this.emitter.event;

    /** Trips the token, notifying anything already listening. */
    public cancel(): void {
        if (this.isCancellationRequested) {
            return;
        }

        this.isCancellationRequested = true;
        this.emitter.fire();
    }

    public dispose(): void {
        this.emitter.dispose();
    }
}
