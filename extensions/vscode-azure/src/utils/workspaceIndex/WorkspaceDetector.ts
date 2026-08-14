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

/**
 * Recognises something in the workspace and records it as tags.
 *
 * Every detector is offered every file and directory, and decides for itself
 * what is interesting. There is no separate declaration of interest to keep in
 * sync with the code that acts on it: a detector that only wants `.csproj`
 * files says so once, by returning early for everything else.
 *
 * {@linkcode inspect} is therefore on the hot path of the walk. Test the cheap
 * things first -- the name via {@linkcode DetectorContext.uri uri}, or
 * {@linkcode DetectorContext.isDirectory isDirectory} -- and only then read
 * {@linkcode DetectorContext.text text}, which is what actually costs.
 */
export interface WorkspaceDetector {
    /** Stable identifier, used in diagnostics. */
    readonly id: string;

    /** The only namespace this detector may apply tags in. */
    readonly namespace: string;

    /**
     * Inspects one file or directory and tags whatever it recognises. Never
     * called concurrently for the same node.
     *
     * Return synchronously when nothing needs reading; the walk only pays for
     * an `await` when a detector actually returns a promise.
     */
    inspect(node: DetectorContext): void | Promise<void>;
}
