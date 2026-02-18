/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IActionContext {
    readonly telemetry: {
        readonly properties: Record<string, string> & { result?: 'Succeeded' | 'Failed' | 'Canceled' };
        readonly measurements: Record<string, number>;
    };
}
