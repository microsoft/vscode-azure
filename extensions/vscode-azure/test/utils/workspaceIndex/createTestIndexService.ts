/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import type { WorkspaceDetector } from '../../../src/utils/workspaceIndex/WorkspaceDetector';
import type { IWorkspaceIndexService } from '../../../src/utils/workspaceIndex/WorkspaceIndexService';
import { buildWorkspaceIndex } from '../../../src/utils/workspaceIndex/buildWorkspaceIndex';

/**
 * An index service over the mock workspace, built once from `detectors`.
 *
 * The index is built the same way the extension builds it, so a test exercises
 * its detector's real tagging and the real directory exclusions rather than a
 * hand-placed set of tags. Nothing invalidates it, since a test that needs to
 * observe a change can build a second one.
 */
export function createTestIndexService(
    code: IVsCode,
    detectors: readonly WorkspaceDetector[],
): IWorkspaceIndexService {
    const index = buildWorkspaceIndex(code, detectors);
    return {
        getIndex: () => index,
        onDidChangeIndex: () => ({ dispose: () => { /* never fires */ } }),
    };
}
