/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename, type IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import { walkWorkspace, type ScannedDirectory } from './walkWorkspace';
import { MutableWorkspaceIndex, type WorkspaceIndex } from './WorkspaceIndex';
import { wantsFile, type DetectorContext, type IndexedNode, type WorkspaceDetector } from './WorkspaceDetector';
import type { WorkspaceTag } from './WorkspaceTag';

/**
 * Walks the workspace once, letting every detector tag the nodes it recognises,
 * and returns the resulting {@linkcode WorkspaceIndex}.
 *
 * Nodes are visited in a fixed order so detectors can build on each other
 * without any dependency machinery:
 *
 * 1. Directories breadth-first, so a directory is always indexed before
 *    anything inside it and {@linkcode DetectorContext.ancestor} is settled.
 * 2. Within a directory, the directory itself before its files.
 * 3. Detectors in registration order.
 *
 * A detector may only write tags in its own namespace, but may read any tag, so
 * a later detector can refine what an earlier one found. Two detectors sharing
 * a namespace is a registration mistake, not something this guards against.
 *
 * @throws {@linkcode CancellationError} when `token` is cancelled.
 */
export async function buildWorkspaceIndex(
    code: IVsCode,
    detectors: readonly WorkspaceDetector[],
    token?: vscode.CancellationToken,
): Promise<WorkspaceIndex> {
    const index = new MutableWorkspaceIndex();
    const directoryDetectors = detectors.filter(detector => detector.directories);
    const fileDetectors = detectors.filter(detector => detector.files);
    // Nearest tagged ancestor is resolved by walking up this map, which is safe
    // because a directory is always recorded before its descendants are visited.
    const directoriesByUri = new Map<string, IndexedNode>();

    for await (const directory of walkWorkspace(code, token)) {
        const directoryNode = toIndexedNode(code, directory);
        directoriesByUri.set(directory.uri.toString(), directoryNode);

        for (const detector of directoryDetectors) {
            await detector.inspect(createContext(
                code, detector, directoryNode, directory, undefined, index, directoriesByUri));
        }

        for (const fileName of directory.fileNames) {
            const interested = fileDetectors.filter(detector => wantsFile(detector, fileName));
            if (interested.length === 0) {
                continue;
            }

            const fileNode = toFileNode(directory, fileName);
            for (const detector of interested) {
                await detector.inspect(createContext(
                    code, detector, fileNode, directory, fileName, index, directoriesByUri));
            }
        }
    }

    return index;
}

function createContext(
    code: IVsCode,
    detector: WorkspaceDetector,
    node: IndexedNode,
    directory: ScannedDirectory,
    fileName: string | undefined,
    index: MutableWorkspaceIndex,
    directoriesByUri: ReadonlyMap<string, IndexedNode>,
): DetectorContext {
    return {
        ...node,
        // A file node has no children of its own; its siblings are visible to
        // detectors inspecting the parent directory instead.
        fileNames: fileName === undefined ? directory.fileNames : new Set<string>(),
        text: () => fileName === undefined
            ? Promise.resolve(undefined)
            : directory.text(fileName),
        json: () => fileName === undefined
            ? Promise.resolve(undefined)
            : directory.json(fileName),
        has: tag => index.has(node.uri, tag),
        ancestor: tag => findAncestor(code, node, directoriesByUri, index, tag),
        tag: (tag, value) => {
            if (tag.namespace !== detector.namespace.name) {
                throw new RangeError(
                    `Detector '${detector.id}' may only apply tags in namespace `
                    + `'${detector.namespace.name}', not '${tag.qualifiedName}'`);
            }
            index.add(node, tag, value);
        },
    };
}

/**
 * Walks up the recorded directories from `node` looking for `tag`.
 *
 * A file's own directory counts as an ancestor, so a detector can ask whether
 * the file sits inside a project root without special-casing depth.
 *
 * Traverses by URI (`..` joins) rather than slicing path strings, and stops
 * once a step no longer changes the URI -- the filesystem root.
 */
function findAncestor<T>(
    code: IVsCode,
    node: IndexedNode,
    directoriesByUri: ReadonlyMap<string, IndexedNode>,
    index: MutableWorkspaceIndex,
    tag: WorkspaceTag<T>,
): IndexedNode | undefined {
    let current = node.isDirectory ? parentUri(code, node.uri) : code.Uri.joinPath(node.uri, '..');

    while (current) {
        const directory = directoriesByUri.get(current.toString());
        if (directory && index.has(directory.uri, tag)) {
            return directory;
        }
        current = parentUri(code, current);
    }
    return undefined;
}

/** The containing directory, or `undefined` once the root is reached. */
function parentUri(code: IVsCode, uri: vscode.Uri): vscode.Uri | undefined {
    const parent = code.Uri.joinPath(uri, '..');
    return parent.toString() === uri.toString() ? undefined : parent;
}

function toIndexedNode(code: IVsCode, directory: ScannedDirectory): IndexedNode {
    return {
        uri: directory.uri,
        name: basename(directory.uri),
        relativePath: directory.relativePath,
        workspaceFolder: directory.workspaceFolder,
        isDirectory: true,
    };
}

function toFileNode(directory: ScannedDirectory, fileName: string): IndexedNode {
    return {
        uri: directory.fileUri(fileName),
        name: fileName,
        relativePath: directory.relativePath === '.'
            ? fileName
            : `${directory.relativePath}/${fileName}`,
        workspaceFolder: directory.workspaceFolder,
        isDirectory: false,
    };
}
