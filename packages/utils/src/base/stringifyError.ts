/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as util from 'node:util';

/**
 * Coerces an unknown thrown value into a human-readable message string.
 *
 * Returns the {@linkcode Error.message message} when {@linkcode error} is an
 * {@linkcode Error}; otherwise stringifies the value using `util.inspect`. Use
 * this when handling a value from a `catch` clause, whose type is `unknown`.
 */
export function stringifyError(error: unknown): string {
    if (typeof error === 'string') {
        return error;
    } else if (error instanceof Error || Error.isError(error)) {
        return error.message;
    }

    return util.inspect(error);
}
