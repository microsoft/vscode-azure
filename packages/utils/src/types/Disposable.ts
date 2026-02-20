/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { AssertAssignable } from './AssertAssignable';

export interface Disposable {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dispose(): any;
}

/* eslint-disable @typescript-eslint/no-unused-vars */
type ForwardDisposable = AssertAssignable<Disposable, vscode.Disposable>;
type BackwardDisposable = AssertAssignable<vscode.Disposable, Disposable>;
/* eslint-enable @typescript-eslint/no-unused-vars */
