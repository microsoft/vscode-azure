/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Layers {@linkcode overrides} onto the current process environment, producing
 * the environment a child process should inherit.
 *
 * @remarks
 * Windows environment variable names are case-insensitive, so an override
 * spelled differently than the existing entry (`Path` against Node's
 * canonical `PATH`) must replace it rather than sit alongside it. A merge that
 * produced both spellings would be rejected with `ERR_INVALID_ENVIRONMENT`,
 * and the child would otherwise inherit an ambiguous environment.
 *
 * Names are matched exactly on other platforms, where the environment is
 * genuinely case-sensitive.
 *
 * @returns A fresh object; {@linkcode process.env} is never mutated. On Windows
 * the result holds at most one spelling of any given name, even when
 * {@linkcode overrides} supplies several.
 */
export function mergeProcessEnv(overrides?: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
    const merged: NodeJS.ProcessEnv = { ...process.env };
    if (!overrides) {
        return merged;
    }

    if (process.platform !== 'win32') {
        return Object.assign(merged, overrides);
    }

    const existingKeysByName = new Map<string, string>();
    for (const key of Object.keys(merged)) {
        existingKeysByName.set(key.toLowerCase(), key);
    }

    for (const [key, value] of Object.entries(overrides)) {
        const name = key.toLowerCase();
        // Recorded so a second override differing only in case collapses onto
        // the same key rather than adding a rival spelling.
        const target = existingKeysByName.get(name) ?? key;
        existingKeysByName.set(name, target);
        merged[target] = value;
    }

    return merged;
}
