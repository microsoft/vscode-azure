/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ManagedCommand {
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- `unknown` or `Promise<unknown>` is clearer than just `unknown`
    execute(): unknown | Promise<unknown>;
}
