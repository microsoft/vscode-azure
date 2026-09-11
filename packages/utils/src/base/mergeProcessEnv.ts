/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessMap } from '../data/CaselessMap';

/**
 * Layers {@linkcode overrides} onto the current process environment, producing
 * the environment a child process should inherit.
 *
 * @remarks
 * Windows environment variable names are case-insensitive, so an override
 * spelled differently than the existing entry (`PATH` against an inherited
 * `Path`, for example) must replace it rather than sit alongside it. A merge that
 * produced both spellings would be rejected with `ERR_INVALID_ENVIRONMENT`,
 * and the child would otherwise inherit an ambiguous environment.
 * {@linkcode CaselessMap} supplies that folding, keeping the casing each name
 * was first seen with.
 *
 * Names are matched exactly on other platforms, where the environment is
 * genuinely case-sensitive.
 *
 * @returns A fresh object; {@linkcode process.env} is never mutated. On Windows
 * the result holds at most one spelling of any given name, even when
 * {@linkcode overrides} supplies several.
 */
export function mergeProcessEnv(overrides?: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
    if (!overrides) {
        return { ...process.env };
    }

    if (process.platform !== 'win32') {
        return { ...process.env, ...overrides };
    }

    const merged = new CaselessMap<string | undefined>(Object.entries(process.env));
    for (const [key, value] of Object.entries(overrides)) {
        merged.set(key, value);
    }

    return Object.fromEntries(merged);
}
