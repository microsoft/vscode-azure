/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

export interface Disposable {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dispose(): any;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Disposable {
    export const None: Disposable = { dispose: () => { /* noop */ } } satisfies vscode.Disposable; // The satisfies also makes sure the interfaces are compatible
};
