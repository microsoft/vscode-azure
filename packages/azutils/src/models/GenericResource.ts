/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface GenericResource {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly kind?: string;
}
