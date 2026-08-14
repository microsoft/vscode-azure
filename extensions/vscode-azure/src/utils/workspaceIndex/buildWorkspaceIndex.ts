/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename, isFileNotFoundError, readText, type IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import { walkDirectory, walkWorkspace, type ScannedDirectory } from './walkWorkspace';
import { MutableWorkspaceIndex } from './WorkspaceIndex';
import type { DetectorContext, WorkspaceDetector } from './WorkspaceDetector';

/**
 * A file node sees no file names.
 *
 * Its siblings belong to the directory that contains them, and a detector that
 * wants them should inspect that directory instead. Keeping this empty is what
 * bounds an incremental update to the changed node and its parent: if a file's
 * tags could depend on its siblings, every sibling would have to be evicted and
 * re-inspected whenever any one of them changed.
 */
const noFileNames: ReadonlySet<string> = new Set<string>();

/**
 * Walks the workspace once, offering every file and directory to every
 * detector, and returns the resulting index.
 *
 * Nodes are visited in a fixed order so detectors can build on each other
 * without any dependency machinery: directories breadth-first, each directory
 * before its own files, and detectors in registration order.
 *
 * A detector may only apply tags in its own namespace, but may read any tag, so
 * a later detector can refine what an earlier one found. Two detectors sharing
 * a namespace is a registration mistake, not something this guards against.
 *
 * @throws {@linkcode CancellationError} when `token` is cancelled.
 */
export async function buildWorkspaceIndex(
    code: IVsCode,
    detectors: readonly WorkspaceDetector[],
    token?: vscode.CancellationToken,
): Promise<MutableWorkspaceIndex> {
    const index = new MutableWorkspaceIndex();

    for await (const directory of walkWorkspace(code, token)) {
        await inspectDirectory(code, detectors, directory, index);
    }

    return index;
}

/**
 * Re-inspects the part of the workspace affected by a change to `uri`, updating
 * `index` in place.
 *
 * The affected part is `uri` itself -- its whole subtree, when it is or was a
 * directory, since deleting a directory reports one event for the directory
 * rather than one per file inside it -- plus its parent directory, whose own
 * tags depend on the set of file names it contains. Siblings are deliberately
 * untouched; {@linkcode noFileNames} is what makes that sound.
 *
 * Everything affected is evicted before anything is re-inspected, and nothing
 * is re-inspected that was not evicted, so a tag carrying values cannot
 * accumulate them twice.
 *
 * @returns Whether the index changed, so a caller can skip announcing an update
 *   no consumer would see.
 * @throws {@linkcode CancellationError} when `token` is cancelled.
 */
export async function updateWorkspaceIndex(
    code: IVsCode,
    detectors: readonly WorkspaceDetector[],
    index: MutableWorkspaceIndex,
    uri: vscode.Uri,
    token?: vscode.CancellationToken,
): Promise<boolean> {
    const parent = code.Uri.joinPath(uri, '..');
    // Evicting a subtree covers the plain file case, and is the only option for
    // a delete, where there is nothing left to stat.
    let changed = index.evictSubtree(uri);
    changed = index.evict(parent) || changed;

    const type = await statType(code, uri);
    if (type === 'directory') {
        for await (const directory of walkDirectory(code, uri, token)) {
            changed = await inspectDirectory(code, detectors, directory, index) || changed;
        }
    } else if (type === 'file') {
        changed = await inspectNode(code, detectors, uri, false, noFileNames, index) || changed;
    }

    // The parent is re-read rather than remembered, so its file names reflect
    // the change. Only the directory node is re-inspected -- its files were not
    // evicted, and re-inspecting them would double their tag values.
    const fileNames = await readFileNames(code, parent);
    if (fileNames) {
        changed = await inspectNode(code, detectors, parent, true, fileNames, index) || changed;
    }

    return changed;
}

/** Offers one directory, and then each file inside it, to every detector. */
async function inspectDirectory(
    code: IVsCode,
    detectors: readonly WorkspaceDetector[],
    directory: ScannedDirectory,
    index: MutableWorkspaceIndex,
): Promise<boolean> {
    let tagged = await inspectNode(code, detectors, directory.uri, true, directory.fileNames, index);

    for (const fileName of directory.fileNames) {
        const uri = code.Uri.joinPath(directory.uri, fileName);
        tagged = await inspectNode(code, detectors, uri, false, noFileNames, index) || tagged;
    }

    return tagged;
}

/** Offers one node to each detector in turn, one at a time. */
async function inspectNode(
    code: IVsCode,
    detectors: readonly WorkspaceDetector[],
    uri: vscode.Uri,
    isDirectory: boolean,
    fileNames: ReadonlySet<string>,
    index: MutableWorkspaceIndex,
): Promise<boolean> {
    let tagged = false;

    for (const detector of detectors) {
        const context: DetectorContext = {
            uri,
            name: basename(uri),
            isDirectory,
            fileNames,
            text: () => isDirectory ? Promise.resolve(undefined) : readText(code, uri),
            has: tag => index.has(uri, tag),
            tag: (tag, value) => {
                if (!tag.startsWith(`${detector.namespace}:`)) {
                    throw new RangeError(
                        `Detector '${detector.id}' may only apply tags in namespace `
                        + `'${detector.namespace}', not '${tag}'`);
                }
                index.add(uri, tag, value);
                tagged = true;
            },
        };

        // Every detector sees every node, so the common case is a detector that
        // recognises nothing and returns synchronously. Awaiting that would
        // cost a microtask per detector per node for nothing.
        const result = detector.inspect(context);
        if (result) {
            await result;
        }
    }

    return tagged;
}

/** Whether `uri` is currently a directory, a file, or gone. */
async function statType(code: IVsCode, uri: vscode.Uri): Promise<'directory' | 'file' | 'missing'> {
    try {
        const stat = await code.workspace.fs.stat(uri);
        return (stat.type & code.FileType.Directory) !== 0 ? 'directory' : 'file';
    } catch (error) {
        if (isFileNotFoundError(error)) {
            return 'missing';
        }
        throw error;
    }
}

/** The names of the files directly inside `uri`, or `undefined` if it is gone. */
async function readFileNames(code: IVsCode, uri: vscode.Uri): Promise<ReadonlySet<string> | undefined> {
    try {
        const entries = await code.workspace.fs.readDirectory(uri);
        const fileNames = new Set<string>();
        for (const [name, type] of entries) {
            if ((type & code.FileType.File) !== 0) {
                fileNames.add(name);
            }
        }
        return fileNames;
    } catch (error) {
        if (isFileNotFoundError(error)) {
            return undefined;
        }
        throw error;
    }
}
