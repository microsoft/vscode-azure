/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Removes all trailing forward slashes in linear time, preserving internal slashes.
 * Empty and slash-only strings return an empty string.
 */
export function stripTrailingSlash(value: string): string {
    let end = value.length;
    while (end > 0 && value[end - 1] === '/') {
        end--;
    }
    return value.slice(0, end);
}
