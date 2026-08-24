/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActionExecutor } from '../src/base/IActionExecutor';
import { NullTelemetryReporter, type ITelemetryReporter } from '../src/base/ITelemetryReporter';
import type { IOutputChannel } from '../src/vscode/IOutputChannel';
import type { IVsCode } from '../src/vscode/IVsCode';
import { MockOutputChannel } from './vscode/MockOutputChannel';
import { createMockVsCode, type MockVsCodeResult } from './vscode/MockVsCode';

/**
 * Creates an {@linkcode ActionExecutor} suitable for unit tests, backed
 * by a {@linkcode NullTelemetryReporter} and a mock `IVsCode` by default.
 *
 * Returns the executor along with the `IVsCode` mock, reporter, and
 * output channel so tests can inspect calls on them. The full
 * {@linkcode MockVsCodeResult} is exposed as `mockVsCode` for assertions on
 * mock namespaces (e.g. `mockVsCode.window.showErrorMessage.mock`).
 */
export function createTestActionExecutor(options?: {
    reporter?: ITelemetryReporter;
    output?: IOutputChannel;
}): { executor: ActionExecutor; code: IVsCode; reporter: ITelemetryReporter; output: IOutputChannel; mockVsCode: MockVsCodeResult } {
    const mockVsCode = createMockVsCode();
    const code = mockVsCode.vscode;
    const reporter = options?.reporter ?? new NullTelemetryReporter();
    const output = options?.output ?? new MockOutputChannel('test');
    return {
        executor: new ActionExecutor(code, reporter, 'test-extension', output),
        code,
        reporter,
        output,
        mockVsCode,
    };
}
