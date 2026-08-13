/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WorkspaceDetector } from '../../../src/utils/workspaceIndex/WorkspaceDetector';
import { StandardTagNames, tagNamespace } from '../../../src/utils/workspaceIndex/WorkspaceTag';

/*
 * Deliberately synthetic detectors, kept separate from the shipped
 * `functionsDetector` and `azdDetector`.
 *
 * Tests use the real detectors wherever they suffice. These exist because the
 * index has to support two shapes that no shipped detector exercises yet:
 *
 * - Same tag name in two namespaces -- `CsSourceFile` and `NodeSourceFile` are
 *   both `sourceFile`. Both shipped detectors use `projectRoot`, so they cover
 *   namespace separation but not the language-vs-language case namespacing is
 *   really there for.
 * - Many values on one file, layered across namespaces -- one detector reading
 *   only what another already tagged, and recording several findings per file.
 *   Shipped detectors tag one directory per project and read nothing.
 */

const csharp = tagNamespace('csharp');
export const CsProjectRoot = csharp.tag(StandardTagNames.projectRoot);
export const CsSourceFile = csharp.tag(StandardTagNames.sourceFile);

const node = tagNamespace('node');
export const NodeSourceFile = node.tag(StandardTagNames.sourceFile);

const annotations = tagNamespace('annotations');
export const AnnotatedRoot = annotations.tag(StandardTagNames.projectRoot);
export const Annotation = annotations.tag<string>('annotation');

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
 * Records every `[Name("...")]` annotation in the C# sources under a directory
 * holding `marker.txt`.
 *
 * Nothing ships in this shape yet, and it is the one that stresses the index
 * hardest: it layers on another namespace's tags (only files the C# detector
 * called source), reads file contents, resolves a tagged ancestor, and records
 * several values for one tag on a single file.
 */
export const annotationDetector: WorkspaceDetector = {
    id: 'annotations',
    namespace: annotations,
    directories: true,
    files: { suffixes: ['.cs'] },
    async inspect(item) {
        if (item.isDirectory) {
            if (item.fileNames.has('marker.txt')) {
                item.tag(AnnotatedRoot);
            }
            return;
        }

        if (!item.has(CsSourceFile) || !item.ancestor(AnnotatedRoot)) {
            return;
        }
        const source = await item.text() ?? '';
        for (const match of source.matchAll(/\[Name\("([^"]+)"\)\]/g)) {
            item.tag(Annotation, match[1]);
        }
    },
};
