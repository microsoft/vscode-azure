/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IActionContext } from '@microsoft/vscode-azure-utils';

export interface ManagedCommand {
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- `unknown` or `Promise<unknown>` is clearer than just `unknown`
    execute(context: IActionContext, ...args: unknown[]): unknown | Promise<unknown>;
}
