/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';

/**
 * Collection identifier every product binds its detectors to.
 *
 * Bindings are gathered by the index service, so adding a product adds a
 * detector to the single shared walk rather than a second pass.
 */
export const IWorkspaceDetector: ServiceIdentifier<WorkspaceDetector> = Symbol.for('IWorkspaceDetector');

/**
 * A file or directory presented to a {@linkcode WorkspaceDetector}, with the
 * reads and lookups needed to decide what to tag it with.
 */
export interface DetectorContext {
    readonly uri: vscode.Uri;

    readonly isDirectory: boolean;

    /**
     * Names of the files in this directory, or alongside this file. Lets a
     * detector decide from a node's neighbours without a further read.
     */
    readonly fileNames: ReadonlySet<string>;

    /** This node's contents, or `undefined` if it is a directory or missing. */
    text(): Promise<string | undefined>;

    /**
     * Whether this node already carries `tag`. Any namespace may be read, which
     * is how a detector builds on an earlier one's findings.
     */
    has(tag: string): boolean;

    /**
     * Attaches `tag` to this node. Applying the same tag repeatedly with
     * different values accumulates them, which is how one file carries many
     * findings (for example every function defined in it).
     *
     * @throws {@linkcode RangeError} if `tag` is outside the detector's own
     *   namespace, so no detector can forge another's tags.
     */
    tag(tag: string, value?: string): void;
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

    /** The only namespace this detector may apply tags in. */
    readonly namespace: string;

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
