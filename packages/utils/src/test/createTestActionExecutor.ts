/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActionExecutor } from '../base/IActionExecutor';
import type { ITelemetryReporter } from '../base/ITelemetryReporter';
import { NullTelemetryReporter } from '../base/ITelemetryReporter';
import type { IOutputChannel } from '../vscode/IOutputChannel';
import type { IVsCode } from '../vscode/IVsCode';
import { createMockVsCode } from './vscode/MockVsCode';

/**
 * Creates an {@linkcode ActionExecutor} suitable for unit tests, backed
 * by a {@linkcode NullTelemetryReporter} and a mock `IVsCode` by default.
 *
 * Returns the executor along with the `IVsCode` mock and reporter so
 * tests can inspect calls on them.
 */
export function createTestActionExecutor(options?: {
    reporter?: ITelemetryReporter;
    output?: IOutputChannel;
}): { executor: ActionExecutor; code: IVsCode; reporter: ITelemetryReporter } {
    const { vscode: code } = createMockVsCode();
    const reporter = options?.reporter ?? new NullTelemetryReporter();
    return {
        executor: new ActionExecutor(code, reporter, 'test-extension', options?.output),
        code,
        reporter,
    };
}
