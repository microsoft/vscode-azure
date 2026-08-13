/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Identifies a fact a detector can attach to a file or directory.
 *
 * Tags are namespaced by the detector that applies them, so unrelated detectors
 * can use the same name without colliding: a Node detector querying its own
 * `sourceFile` never sees the C# detector's `.cs` files.
 *
 * The type parameter is the value type carried by each application of the tag.
 * It exists only to keep call sites typed -- a `WorkspaceTag<string>` can only
 * be applied with a `string` and only yields `string` values back -- and has no
 * runtime representation.
 *
 * Create tags through {@linkcode tagNamespace}; they are meant to be
 * module-level constants so producers and consumers share one identity.
 */
export interface WorkspaceTag<T = void> {
    readonly namespace: string;
    readonly name: string;
    /** `namespace:name`. The key this tag is indexed under. */
    readonly qualifiedName: string;
    /**
     * Phantom marker that keeps {@linkcode WorkspaceTag} from being assignable
     * across value types, so a `WorkspaceTag<string>` cannot be passed where a
     * `WorkspaceTag<void>` is expected. Never read, and never present at
     * runtime.
     */
    readonly valueMarker?: (value: T) => T;
}

/**
 * A detector's private space of tag names.
 *
 * A detector may only apply tags from its own namespace; attempting to apply a
 * foreign tag throws. Reading is unrestricted, which is what lets detectors
 * layer -- a Functions detector can look for the C# detector's `sourceFile` tag
 * and add its own findings to those files.
 */
export interface TagNamespace {
    readonly name: string;

    /**
     * Defines a tag in this namespace.
     *
     * @param name - Prefer a {@linkcode StandardTagNames} value when one fits,
     *   so unrelated detectors describe the same concept the same way. Any
     *   string is accepted; the standard names are a vocabulary, not a limit.
     */
    tag<T = void>(name: string): WorkspaceTag<T>;
}

/**
 * Creates a {@linkcode TagNamespace}.
 *
 * The name should identify the producing feature (`functions`, `azd`,
 * `csharp`). Registering two detectors with the same namespace is rejected when
 * the index is built.
 *
 * @throws {@linkcode RangeError} if `name` is empty or contains `:`, which
 *   separates the namespace from the name in
 *   {@linkcode WorkspaceTag.qualifiedName}.
 */
export function tagNamespace(name: string): TagNamespace {
    if (!name) {
        throw new RangeError('A tag namespace must not be empty');
    }
    if (name.includes(':')) {
        throw new RangeError(`A tag namespace must not contain ':': ${name}`);
    }

    return {
        name,
        tag<T = void>(tagName: string): WorkspaceTag<T> {
            if (!tagName) {
                throw new RangeError('A tag name must not be empty');
            }
            if (tagName.includes(':')) {
                throw new RangeError(`A tag name must not contain ':': ${tagName}`);
            }
            return {
                namespace: name,
                name: tagName,
                qualifiedName: `${name}:${tagName}`,
            };
        },
    };
}

/**
 * Conventional tag names.
 *
 * A shared vocabulary rather than a closed set: detectors may define any name
 * they need, but should reach for one of these when it fits, so that unrelated
 * detectors describe the same concept the same way.
 */
export const StandardTagNames = {
    /** A directory that is the root of a project. */
    projectRoot: 'projectRoot',
    /** A file that defines a project (`*.csproj`, `package.json`, `host.json`). */
    projectFile: 'projectFile',
    /** A file containing code the project builds or runs. */
    sourceFile: 'sourceFile',
    /** A file declaring dependencies or metadata. */
    manifest: 'manifest',
    /** A resolved dependency lock file. */
    lockFile: 'lockFile',
    /** A file configuring tooling or runtime behaviour. */
    configFile: 'configFile',
} as const;
