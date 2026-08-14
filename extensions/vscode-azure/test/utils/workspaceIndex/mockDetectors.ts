/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WorkspaceDetector } from '../../../src/utils/workspaceIndex/WorkspaceDetector';
import { createTag, StandardTagNames } from '../../../src/utils/workspaceIndex/tags';

/*
 * Deliberately synthetic detectors, kept separate from the shipped
 * `functionsDetector` and `azdDetector`.
 *
 * Tests use the real detectors wherever they suffice. These exist because the
 * index has to support two shapes that no shipped detector exercises yet:
 *
 * - Same tag name in two namespaces -- `CsSourceFile` and `NodeSourceFile` are
 *   both `sourceFile`. Both shipped detectors use `projectFile`, so they cover
 *   namespace separation but not the language-vs-language case namespacing is
 *   really there for.
 * - Many values on one file, layered across namespaces -- one detector reading
 *   only what another already tagged, and recording several findings per file.
 *   Shipped detectors tag one file per project and read nothing.
 */

export const CsProjectRoot = createTag('csharp', StandardTagNames.projectRoot);
export const CsSourceFile = createTag('csharp', StandardTagNames.sourceFile);
export const NodeSourceFile = createTag('node', StandardTagNames.sourceFile);
export const AttributedRoot = createTag('attributes', StandardTagNames.projectRoot);
export const Attribute = createTag('attributes', 'Attribute');

/** Tags `.cs` files, and the directories holding a `.csproj`. */
export const csharpDetector: WorkspaceDetector = {
    id: 'csharp',
    namespace: 'csharp',
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
    namespace: 'node',
    files: { suffixes: ['.js'] },
    inspect(item) { item.tag(NodeSourceFile); },
};

/**
 * Records every `[Name("...")]` attribute in the C# sources of a directory
 * holding `marker.txt`.
 *
 * Nothing ships in this shape yet, and it is the one that stresses the index
 * hardest: it layers on another namespace's tags (only files the C# detector
 * called source), reads file contents, looks at a node's neighbours, and
 * records several values for one tag on a single file.
 */
export const attributeDetector: WorkspaceDetector = {
    id: 'attributes',
    namespace: 'attributes',
    directories: true,
    files: { suffixes: ['.cs'] },
    async inspect(item) {
        if (item.isDirectory) {
            if (item.fileNames.has('marker.txt')) {
                item.tag(AttributedRoot);
            }
            return;
        }

        if (!item.has(CsSourceFile) || !item.fileNames.has('marker.txt')) {
            return;
        }
        const source = await item.text() ?? '';
        for (const match of source.matchAll(/\[Name\("([^"]+)"\)\]/g)) {
            item.tag(Attribute, match[1]);
        }
    },
};
