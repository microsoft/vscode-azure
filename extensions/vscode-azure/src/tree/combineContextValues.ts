/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Combines context values into a single string by sorting and then joining with `;`.
 */
export function combineContextValues(...contextValues: string[]): string {
    return contextValues.sort().join(';');
}
