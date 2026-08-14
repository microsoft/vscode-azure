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
 * Walks the workspace once, letting every detector tag the nodes it recognises,
 * and returns the resulting {@linkcode WorkspaceIndex}.
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
    const directoryDetectors = detectors.filter(detector => detector.directories);
    const fileDetectors = detectors.filter(detector => detector.files);

    for await (const directory of walkWorkspace(code, token)) {
        await inspectAll(code, directoryDetectors, directory.uri, true, directory.fileNames, index);

        for (const fileName of directory.fileNames) {
            const interested = fileDetectors.filter(detector => wantsFile(detector, fileName));
            if (interested.length > 0) {
                const uri = code.Uri.joinPath(directory.uri, fileName);
                await inspectAll(code, interested, uri, false, directory.fileNames, index);
            }
        }
    }

    return index;
}

/** Whether `detector` wants to inspect a file called `fileName`. */
function wantsFile(detector: WorkspaceDetector, fileName: string): boolean {
    const files = detector.files;
    return (files?.names?.includes(fileName) ?? false)
        || (files?.suffixes?.some(suffix => fileName.endsWith(suffix)) ?? false);
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
        await detector.inspect(context);
    }
}
