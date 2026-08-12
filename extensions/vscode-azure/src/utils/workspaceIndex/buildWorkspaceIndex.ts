/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import { walkWorkspace, type ScannedDirectory, type WalkWorkspaceOptions } from '../walkWorkspace';
import { MutableWorkspaceIndex, type WorkspaceIndex } from './WorkspaceIndex';
import { wantsFile, type DetectorContext, type IndexedNode, type WorkspaceDetector } from './WorkspaceDetector';
import type { WorkspaceTag } from './WorkspaceTag';

/** Options for {@linkcode buildWorkspaceIndex}. */
export type BuildWorkspaceIndexOptions = WalkWorkspaceOptions;

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
 * a later detector can refine what an earlier one found.
 *
 * @throws {@linkcode RangeError} if two detectors share a tag namespace.
 * @throws {@linkcode CancellationError} when `token` is cancelled.
 */
export async function buildWorkspaceIndex(
    code: IVsCode,
    detectors: readonly WorkspaceDetector[],
    token?: vscode.CancellationToken,
    options: BuildWorkspaceIndexOptions = {},
): Promise<WorkspaceIndex> {
    assertDistinctNamespaces(detectors);

    const index = new MutableWorkspaceIndex();
    const directoryDetectors = detectors.filter(detector => detector.directories);
    const fileDetectors = detectors.filter(detector => detector.files);
    // Nearest tagged ancestor is resolved by walking up this map, which is safe
    // because a directory is always recorded before its descendants are visited.
    const directoriesByPath = new Map<string, IndexedNode>();

    const walk = walkWorkspace(code, token, options);
    for await (const directory of walk) {
        const directoryNode = toIndexedNode(directory);
        directoriesByPath.set(directory.relativePath, directoryNode);

        for (const detector of directoryDetectors) {
            await detector.inspect(createContext(
                detector, directoryNode, directory, undefined, index, directoriesByPath));
        }

        for (const fileName of directory.fileNames) {
            const interested = fileDetectors.filter(detector => wantsFile(detector, fileName));
            if (interested.length === 0) {
                continue;
            }

            const fileNode = toFileNode(directory, fileName);
            for (const detector of interested) {
                await detector.inspect(createContext(
                    detector, fileNode, directory, fileName, index, directoriesByPath));
            }
        }
    }

    index.truncated = walk.truncated;
    return index;
}

function createContext(
    detector: WorkspaceDetector,
    node: IndexedNode,
    directory: ScannedDirectory,
    fileName: string | undefined,
    index: MutableWorkspaceIndex,
    directoriesByPath: ReadonlyMap<string, IndexedNode>,
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
        valuesOf: tag => index.valuesOf(node.uri, tag),
        ancestor: tag => findAncestor(node, directoriesByPath, index, tag),
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
 */
function findAncestor<T>(
    node: IndexedNode,
    directoriesByPath: ReadonlyMap<string, IndexedNode>,
    index: MutableWorkspaceIndex,
    tag: WorkspaceTag<T>,
): IndexedNode | undefined {
    let path = node.isDirectory ? parentPath(node.relativePath) : directoryPath(node.relativePath);

    while (path !== undefined) {
        const directory = directoriesByPath.get(path);
        if (directory && index.has(directory.uri, tag)) {
            return directory;
        }
        path = parentPath(path);
    }
    return undefined;
}

function toIndexedNode(directory: ScannedDirectory): IndexedNode {
    return {
        uri: directory.uri,
        name: lastSegment(directory.relativePath) ?? lastSegment(directory.uri.path) ?? '',
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

function assertDistinctNamespaces(detectors: readonly WorkspaceDetector[]): void {
    const seen = new Map<string, string>();
    for (const detector of detectors) {
        const owner = seen.get(detector.namespace.name);
        if (owner) {
            throw new RangeError(
                `Detectors '${owner}' and '${detector.id}' both use the tag namespace `
                + `'${detector.namespace.name}'`);
        }
        seen.set(detector.namespace.name, detector.id);
    }
}

/** The directory containing a file, in the same form directories are keyed by. */
function directoryPath(relativePath: string): string {
    const index = relativePath.lastIndexOf('/');
    return index === -1 ? '.' : relativePath.slice(0, index);
}

/** The parent of a directory path, or `undefined` at the scope root. */
function parentPath(relativePath: string): string | undefined {
    if (relativePath === '.') {
        return undefined;
    }
    const index = relativePath.lastIndexOf('/');
    return index === -1 ? '.' : relativePath.slice(0, index);
}

function lastSegment(path: string): string | undefined {
    return path.split('/').filter(Boolean).pop();
}
