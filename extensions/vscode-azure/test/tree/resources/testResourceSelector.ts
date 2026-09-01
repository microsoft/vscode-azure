/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { createMockDataItemTree, createMockViewItemTree } from '@microsoft/vscode-azure-azutils/testing';
import type { ActionExecutor, ICodeContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, createTestActionExecutor, MockOutputChannel, type MockCodeContextResult } from '@microsoft/vscode-azure-utils/testing';
import type { IAzureViewDataTree, IAzureViewViewItemTree } from '../../../src/services';
import { ResourceSelector } from '../../../src/tree/resources/ResourceSelector';

interface TestResourceSelectorOptions {
    /** Nodes the selector can resolve keys against. Ignored when `cache` is supplied. */
    readonly nodes?: readonly ConcreteAzureNode[];
    /** Data cache to resolve against, when the caller needs to observe it. */
    readonly cache?: IAzureViewDataTree;
    /** Only needed by tests that exercise the prompting path of `select`. Defaults to an empty tree. */
    readonly viewTree?: IAzureViewViewItemTree;
    /** Reuse a context whose workspace state or mock calls the test inspects. */
    readonly codeContext?: MockCodeContextResult;
}

interface TestResourceSelectorResult {
    readonly selector: ResourceSelector;
    readonly cache: IAzureViewDataTree;
    readonly codeContext: MockCodeContextResult;
    readonly ctx: ICodeContext;
    /** Runs actions so telemetry written by the selector can be asserted. */
    readonly executor: ActionExecutor;
}

/**
 * Builds a {@linkcode ResourceSelector} over an in-memory data cache, for tests
 * of the selector itself and of the commands that resolve through it.
 */
export function createTestResourceSelector(options: TestResourceSelectorOptions = {}): TestResourceSelectorResult {
    const codeContext = options.codeContext ?? createMockCodeContext();
    const cache = options.cache ?? createMockDataItemTree([...(options.nodes ?? [])]);
    const viewTree = options.viewTree ?? (createMockViewItemTree({}) as unknown as IAzureViewViewItemTree);
    const { executor } = createTestActionExecutor();

    const selector = new ResourceSelector(
        codeContext.ctx,
        new MockOutputChannel('test'),
        cache,
        viewTree,
        executor,
    );

    return { selector, cache, codeContext, ctx: codeContext.ctx, executor };
}
