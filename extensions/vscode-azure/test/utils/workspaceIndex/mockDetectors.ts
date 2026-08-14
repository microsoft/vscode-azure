/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '@microsoft/vscode-azure-utils';
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

export const CsProjectFile = createTag('csharp', StandardTagNames.projectFile);
export const CsSourceFile = createTag('csharp', StandardTagNames.sourceFile);
export const NodeProjectFile = createTag('node', StandardTagNames.projectFile);
export const NodeSourceFile = createTag('node', StandardTagNames.sourceFile);
export const Attribute = createTag('attributes', 'Attribute');

/** Tags `.csproj` project files and the `.cs` sources they build. */
export const csharpDetector: WorkspaceDetector = {
    id: 'csharp',
    namespace: 'csharp',
    files: { suffixes: ['.csproj', '.cs'] },
    inspect(item) {
        if (item.uri.path.endsWith('.csproj')) {
            item.tag(CsProjectFile);
        } else {
            item.tag(CsSourceFile);
        }
    },
};

/**
 * Tags `package.json` and the sources beside it, so that `node:sourceFile` and
 * `csharp:sourceFile` coexist without colliding.
 */
export const nodeDetector: WorkspaceDetector = {
    id: 'node',
    namespace: 'node',
    files: {
        names: ['package.json'],
        suffixes: ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'],
    },
    inspect(item) {
        if (basename(item.uri) === 'package.json') {
            item.tag(NodeProjectFile);
        } else {
            item.tag(NodeSourceFile);
        }
    },
};

/**
 * Records every `[Name("...")]` attribute in each file the C# detector
 * recognised as source.
 *
 * Nothing ships in this shape yet, and it is the one that stresses the index
 * hardest: it layers on another namespace's tags, reads file contents, and
 * records several values for one tag on a single file.
 */
export const attributeDetector: WorkspaceDetector = {
    id: 'attributes',
    namespace: 'attributes',
    files: { suffixes: ['.cs'] },
    async inspect(item) {
        if (!item.has(CsSourceFile)) {
            return;
        }
        const source = await item.text() ?? '';
        for (const match of source.matchAll(/\[Name\("([^"]+)"\)\]/g)) {
            item.tag(Attribute, match[1]);
        }
    },
};
