/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readText, type IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import { walkWorkspace } from './walkWorkspace';
import { MutableWorkspaceIndex, type WorkspaceIndex } from './WorkspaceIndex';
import type { DetectorContext, WorkspaceDetector } from './WorkspaceDetector';

/**
 * Walks the workspace once, offering every file and directory to every
 * detector, and returns the resulting {@linkcode WorkspaceIndex}.
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
): Promise<WorkspaceIndex> {
    const index = new MutableWorkspaceIndex();

    for await (const directory of walkWorkspace(code, token)) {
        await inspectAll(code, detectors, directory.uri, true, directory.fileNames, index);

        for (const fileName of directory.fileNames) {
            const uri = code.Uri.joinPath(directory.uri, fileName);
            await inspectAll(code, detectors, uri, false, directory.fileNames, index);
        }
    }

    return index;
}

/** Offers one node to each detector in turn, one at a time. */
async function inspectAll(
    code: IVsCode,
    detectors: readonly WorkspaceDetector[],
    uri: vscode.Uri,
    isDirectory: boolean,
    fileNames: ReadonlySet<string>,
    index: MutableWorkspaceIndex,
): Promise<void> {
    for (const detector of detectors) {
        const context: DetectorContext = {
            uri,
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
}
