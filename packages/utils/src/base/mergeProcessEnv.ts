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
        merged[existingKeysByName.get(key.toLowerCase()) ?? key] = value;
    }

    return merged;
}
