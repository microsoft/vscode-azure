/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LogStreamTerminal } from '../../utils/logStream/LogStreamTerminal';

/** Starts its owned process when the task opens, and closes the task when that process exits. */
export class FunctionsHostTerminal extends LogStreamTerminal {
    private started = false;

    public constructor(private readonly start: () => void, cancel: () => void) { super(cancel); }

    public override open(): void {
        super.open();
        if (!this.started && !this.closed) {
            this.started = true;
            this.start();
        }
    }
}
