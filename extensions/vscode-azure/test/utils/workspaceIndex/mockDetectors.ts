/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DetectorContext, WorkspaceDetector } from '../../../src/utils/workspaceIndex/WorkspaceDetector';
import { StandardTagNames, tagNamespace } from '../../../src/utils/workspaceIndex/WorkspaceTag';

/**
 * Deliberately synthetic detectors, kept separate from the shipped ones in
 * {@linkcode functionsDetector} and {@linkcode azdDetector}.
 *
 * Tests use the real detectors wherever they suffice. These exist because the
 * index has to support two shapes that no shipped detector exercises yet:
 *
 * - **Same tag name in two namespaces** -- {@linkcode CsSourceFile} and
 *   {@linkcode NodeSourceFile} are both `sourceFile`. Both shipped detectors use
 *   {@linkcode StandardTagNames.projectRoot}, so they cover namespace separation
 *   but not the language-vs-language case namespacing is really there for.
 * - **Many values on one file, layered across namespaces** -- the shape #178
 *   needs. Shipped detectors tag one directory per project and read nothing.
 *
 * Once real per-language detectors land, these should be deleted in favour of
 * them.
 */

const csharp = tagNamespace('csharp');
export const CsProjectRoot = csharp.tag(StandardTagNames.projectRoot);
export const CsSourceFile = csharp.tag(StandardTagNames.sourceFile);

const node = tagNamespace('node');
export const NodeSourceFile = node.tag(StandardTagNames.sourceFile);

const functions = tagNamespace('test-functions');
export const TestFunctionsProject = functions.tag(StandardTagNames.projectRoot);
export const TestFunctionName = functions.tag<string>('functionName');

/** Tags `.cs` files, and the directories holding a `.csproj`. */
export const csharpDetector: WorkspaceDetector = {
    id: 'csharp',
    namespace: csharp,
    directories: true,
    files: { suffixes: ['.cs'] },
    inspect(item) {
        if (item.isDirectory) {
            if ([...item.fileNames].some(name => name.endsWith('.csproj'))) {
                item.tag(CsProjectRoot);
            }
        } else {
            item.tag(CsSourceFile);
        }
    },
};

/** Tags `.js` files, so that `node:sourceFile` and `csharp:sourceFile` coexist. */
export const nodeDetector: WorkspaceDetector = {
    id: 'node',
    namespace: node,
    files: { suffixes: ['.js'] },
    inspect(item) { item.tag(NodeSourceFile); },
};

/**
 * A Functions detector in the shape #178 needs: it tags the project directory,
 * then extracts many function names per source file, reading only files another
 * detector already recognised as source and that sit under a Functions project.
 */
export function functionsDetectorFor(suffixes: readonly string[]): WorkspaceDetector {
    return {
        id: 'test-functions',
        namespace: functions,
        directories: true,
        files: { suffixes: [...suffixes] },
        async inspect(item: DetectorContext) {
            if (item.isDirectory) {
                if (item.fileNames.has('host.json')) {
                    item.tag(TestFunctionsProject);
                }
                return;
            }

            if (!item.has(CsSourceFile) || !item.ancestor(TestFunctionsProject)) {
                return;
            }
            const source = await item.text() ?? '';
            for (const match of source.matchAll(/\[Function\("([^"]+)"\)\]/g)) {
                item.tag(TestFunctionName, match[1]);
            }
        },
    };
}
