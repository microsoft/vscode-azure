/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ManagedCommand<T = unknown> {
    execute(...args: unknown[]): T | Promise<T>; // TODO: should we just pass IActionContext into this instead of the command constructor?
}
