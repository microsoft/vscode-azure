/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActionExecutor } from '../base/IActionExecutor';
import { NullTelemetryReporter, type ITelemetryReporter } from '../base/ITelemetryReporter';
import { DebugOutputChannel, type IOutputChannel } from '../vscode/IOutputChannel';
import type { IVsCode } from '../vscode/IVsCode';
import { createMockVsCode } from './vscode/MockVsCode';

/**
 * Creates an {@linkcode ActionExecutor} suitable for unit tests, backed
 * by a {@linkcode NullTelemetryReporter} and a mock `IVsCode` by default.
 *
 * Returns the executor along with the `IVsCode` mock, reporter, and
 * output channel so tests can inspect calls on them.
 */
export function createTestActionExecutor(options?: {
    reporter?: ITelemetryReporter;
    output?: IOutputChannel;
}): { executor: ActionExecutor; code: IVsCode; reporter: ITelemetryReporter; output: IOutputChannel } {
    const { vscode: code } = createMockVsCode();
    const reporter = options?.reporter ?? new NullTelemetryReporter();
    const output = options?.output ?? new DebugOutputChannel('test');
    return {
        executor: new ActionExecutor(code, reporter, 'test-extension', output),
        code,
        reporter,
        output,
    };
}
