/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Builds the `namespace:name` string a tag is indexed under.
 *
 * Tags are namespaced by the detector that applies them, so unrelated detectors
 * can use the same name without colliding: a Node detector querying its own
 * `sourceFile` never sees the C# detector's `.cs` files. A detector may only
 * apply tags in its own namespace, but may read any tag, which is what lets one
 * detector build on another's findings.
 *
 * Tags are meant to be module-level constants so producers and consumers share
 * one spelling.
 *
 * @param namespace - The producing feature (`functions`, `azd`, `csharp`).
 * @param name - Prefer a {@linkcode StandardTagNames} value when one fits, so
 *   unrelated detectors describe the same concept the same way. Any string is
 *   accepted; the standard names are a vocabulary, not a limit.
 * @throws {@linkcode RangeError} if either part is empty or contains `:`, which
 *   would make the result ambiguous.
 */
export function createTag(namespace: string, name: string): string {
    validate('namespace', namespace);
    validate('name', name);
    return `${namespace}:${name}`;
}

function validate(kind: string, value: string): void {
    if (!value) {
        throw new RangeError(`A tag ${kind} must not be empty`);
    }
    if (value.includes(':')) {
        throw new RangeError(`A tag ${kind} must not contain ':': ${value}`);
    }
}

/**
 * Conventional tag names.
 *
 * A shared vocabulary rather than a closed set: detectors may define any name
 * they need, but should reach for one of these when it fits. Add a name here
 * once a second detector wants it, rather than in anticipation.
 */
export const StandardTagNames = {
    /** A file that defines a project (`*.csproj`, `package.json`, `host.json`). */
    projectFile: 'projectFile',
    /** A file containing code the project builds or runs. */
    sourceFile: 'sourceFile',
} as const;
