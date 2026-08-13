/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import type { TagNamespace, WorkspaceTag } from './WorkspaceTag';

/**
 * Collection identifier every product binds its detectors to.
 *
 * Bindings are gathered by the index service, so adding a product adds a
 * detector to the single shared walk rather than a second pass.
 */
export const IWorkspaceDetector: ServiceIdentifier<WorkspaceDetector> = Symbol.for('IWorkspaceDetector');

/** A file or directory the index knows about. */
export interface IndexedNode {
    readonly uri: vscode.Uri;
    /** Final path segment: the file or directory name. */
    readonly name: string;
    /** POSIX-style path relative to the scope root, or `.` for the root itself. */
    readonly relativePath: string;
    readonly workspaceFolder: vscode.WorkspaceFolder | undefined;
    readonly isDirectory: boolean;
}

/**
 * A node presented to a {@linkcode WorkspaceDetector} for inspection, with the
 * reads and lookups needed to decide what to tag it with.
 *
 * Reads are memoized for the duration of one index build, so several detectors
 * inspecting the same manifest cost a single read.
 */
export interface DetectorContext extends IndexedNode {
    /**
     * Names of the files directly inside this directory. Empty for file nodes,
     * whose siblings are reached by inspecting their parent directory instead.
     */
    readonly fileNames: ReadonlySet<string>;

    /** This node's contents, or `undefined` if it is a directory or too large. */
    text(): Promise<string | undefined>;

    /**
     * Whether this node already carries `tag`. Any namespace may be read, which
     * is how a detector builds on an earlier one's findings.
     */
    has<T>(tag: WorkspaceTag<T>): boolean;

    /**
     * The nearest enclosing directory carrying `tag`, if any.
     *
     * Well-defined because directories are indexed before their contents, so an
     * ancestor's tags are always settled by the time descendants are inspected.
     */
    ancestor<T>(tag: WorkspaceTag<T>): IndexedNode | undefined;

    /**
     * Attaches `tag` to this node. Applying the same tag repeatedly with
     * different values accumulates them, which is how one file carries many
     * findings (for example every function defined in it).
     *
     * @throws {@linkcode RangeError} if `tag` is outside the detector's own
     *   namespace, so no detector can forge another's tags.
     */
    tag<T>(tag: WorkspaceTag<T>, value?: T): void;
}

/** The files a detector wants to inspect. */
export interface DetectorFileInterest {
    /** Exact file names, e.g. `host.json`. */
    readonly names?: readonly string[];
    /** File name suffixes, e.g. `.csproj`. */
    readonly suffixes?: readonly string[];
}

/**
 * Recognises something in the workspace and records it as tags.
 *
 * A detector declares up front which nodes it cares about, which keeps the
 * per-node cost of an unrelated detector to a set lookup and lets the index
 * service watch only the files that could change an answer.
 */
export interface WorkspaceDetector {
    /** Stable identifier, used in diagnostics. */
    readonly id: string;

    /** The only namespace this detector may write tags in. */
    readonly namespace: TagNamespace;

    /** Files to inspect. Omit if the detector only looks at directories. */
    readonly files?: DetectorFileInterest;

    /** Whether every directory should be inspected. Defaults to `false`. */
    readonly directories?: boolean;

    /**
     * Inspects one node and tags it. Called only for nodes matching the
     * declared interest, and never concurrently for the same node.
     */
    inspect(node: DetectorContext): void | Promise<void>;
}

/** Whether `detector` wants to inspect a file called `fileName`. */
export function wantsFile(detector: WorkspaceDetector, fileName: string): boolean {
    const files = detector.files;
    if (!files) {
        return false;
    }
    return (files.names?.includes(fileName) ?? false)
        || (files.suffixes?.some(suffix => fileName.endsWith(suffix)) ?? false);
}
