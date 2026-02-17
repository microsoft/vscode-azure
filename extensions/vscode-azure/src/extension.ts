/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Foo } from '@microsoft/vscode-azure-utils';
import * as vscode from 'vscode';

export async function activateInternal(ctx: vscode.ExtensionContext, perfStats: { loadStartTime: number, loadEndTime: number }): Promise<void> {
    const foo = new Foo('hello');
    console.log(foo);
    await Promise.resolve();
}

export async function deactivateInternal(): Promise<void> {
    await Promise.resolve();
}
