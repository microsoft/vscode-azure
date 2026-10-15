/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';
import type * as vscode from 'vscode';

/** A pseudoterminal fixture with collected output and explicit, inspectable lifecycle actions. */
export class MockTerminal implements vscode.Terminal {
    public readonly name: string;
    public readonly pty: vscode.Pseudoterminal;
    public readonly writes: string[] = [];
    public readonly processId = Promise.resolve(undefined);
    public readonly exitStatus = undefined;
    public readonly state = { isInteractedWith: false, shell: undefined };
    public readonly shellIntegration = undefined;
    public openOnShow = true;

    public readonly show = mock.fn(() => {
        if (this.openOnShow) {
            this.pty.open(undefined);
        }
    });
    public readonly hide = mock.fn();
    public readonly sendText = mock.fn();
    public readonly dispose = mock.fn(() => {
        this.pty.close();
    });

    public constructor(public readonly creationOptions: vscode.ExtensionTerminalOptions) {
        this.name = creationOptions.name;
        this.pty = creationOptions.pty;
        this.pty.onDidWrite(value => {
            this.writes.push(value);
        });
    }
}
