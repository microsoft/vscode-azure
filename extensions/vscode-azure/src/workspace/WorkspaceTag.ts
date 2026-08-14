/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare const workspaceTagBrand: unique symbol;

/**
 * A namespaced label a {@linkcode WorkspaceDetector} can attach to a file or
 * folder in the workspace index, optionally carrying typed metadata.
 *
 * Tags are compared by their qualified {@linkcode WorkspaceTag.name name}
 * (`namespace:name`), not by object identity, so a tag defined once and imported
 * everywhere behaves the same as one reconstructed from its parts. Define each
 * tag exactly once with {@linkcode defineWorkspaceTag} and export it, so
 * producers and consumers agree on the metadata type.
 *
 * The `TMetadata` type parameter is phantom -- it exists only to thread the
 * metadata type from {@linkcode applyTag} through to the query surface, and has
 * no runtime representation.
 *
 * @typeParam TMetadata - Metadata carried by applications of this tag, or
 *   `undefined` for a bare marker tag.
 */
export interface WorkspaceTag<TMetadata = undefined> {
    /** Owning detector's namespace, e.g. `azd`. */
    readonly namespace: string;
    /** Unqualified tag name within the namespace, e.g. `project`. */
    readonly localName: string;
    /** Fully qualified name (`namespace:localName`), used as the index key. */
    readonly name: string;
    /** Phantom marker; never present at runtime. */
    readonly [workspaceTagBrand]?: TMetadata;
}

/**
 * Define a namespaced tag.
 *
 * Supply `TMetadata` when applications of the tag carry data (the type is then
 * enforced at both {@linkcode applyTag} and query sites); omit it for a bare
 * marker tag.
 *
 * @param namespace - Owning detector's namespace. A detector may only apply tags
 *   in its own namespace; see {@linkcode WorkspaceDetector.namespace}.
 * @param localName - Tag name within the namespace.
 *
 * @throws If either part is empty or contains `:`, which would make the
 *   qualified name ambiguous.
 *
 * @example
 * ```ts
 * export const AzdProjectTag = defineWorkspaceTag<{ manifestUri: vscode.Uri }>('azd', 'project');
 * AzdProjectTag.name; // 'azd:project'
 * ```
 */
export function defineWorkspaceTag<TMetadata = undefined>(namespace: string, localName: string): WorkspaceTag<TMetadata> {
    assertTagPart('namespace', namespace);
    assertTagPart('name', localName);
    return { namespace, localName, name: `${namespace}:${localName}` };
}

function assertTagPart(what: string, value: string): void {
    if (!value) {
        throw new Error(`Workspace tag ${what} must not be empty.`);
    } else if (value.includes(':')) {
        throw new Error(`Workspace tag ${what} must not contain ':' (got '${value}').`);
    }
}

/**
 * Local name for "this folder is the root of a project of the owning
 * namespace's kind", e.g. `azd:project`, `functions:project`.
 *
 * Shared so that "the project tag for product X" is spelled the same way
 * everywhere, and so a consumer can recognize the shape of a project tag
 * without knowing the product.
 */
export const ProjectTagName = 'project';

/**
 * One tag applied to one entry, as produced by {@linkcode applyTag} and stored
 * on a workspace index entry.
 *
 * Metadata is typed as `unknown` here because a single entry holds applications
 * of unrelated tags; read it back at the defining tag's type with
 * {@linkcode getTagMetadata}.
 */
export interface AppliedTag {
    readonly tag: WorkspaceTag<never>;
    readonly metadata?: unknown;
}

/**
 * Apply a tag that carries no metadata.
 *
 * @see {@linkcode WorkspaceDetector.visit}, which returns these.
 */
export function applyTag(tag: WorkspaceTag): AppliedTag;
/**
 * Apply a tag together with its metadata. The metadata type is fixed by the
 * tag's definition, so a mismatch is a compile error at the detector.
 */
export function applyTag<TMetadata>(tag: WorkspaceTag<TMetadata>, metadata: TMetadata): AppliedTag;
export function applyTag<TMetadata>(tag: WorkspaceTag<TMetadata>, metadata?: TMetadata): AppliedTag {
    return { tag: tag as WorkspaceTag<never>, metadata };
}
