/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';
import type { AzdDeployCaptureResult, AzdEnvironment, AzdProvisionCaptureResult, IAzdService } from '../../azd/AzdService';

/**
 * A mock {@linkcode IAzdService} with all methods backed by `mock.fn()`.
 * The intersection with `IAzdService` means it can be passed directly
 * to production code without casts.
 */
export type MockAzdService = IAzdService & {
    [K in keyof IAzdService]: ReturnType<typeof mock.fn>;
};

/** Default mock result for {@linkcode IAzdService.provisionWithCapture}. */
function defaultProvisionCaptureResult(): AzdProvisionCaptureResult {
    return {
        deploymentInfo: Promise.resolve(undefined),
        completed: Promise.resolve(),
    };
}

/** Default mock result for {@linkcode IAzdService.deployWithCapture}. */
function defaultDeployCaptureResult(): AzdDeployCaptureResult {
    return {
        completed: Promise.resolve(),
    };
}

/**
 * Creates a mock {@linkcode IAzdService} suitable for unit tests.
 *
 * @param envListResult - The result to return from `envList()`. Defaults to `[]`.
 */
export function createMockAzdService(envListResult: AzdEnvironment[] = []): MockAzdService {
    return {
        findAzureYaml: mock.fn(() => Promise.resolve(undefined)),
        init: mock.fn(() => Promise.resolve()),
        envNew: mock.fn(() => Promise.resolve()),
        envList: mock.fn(() => Promise.resolve(envListResult)),
        envExists: mock.fn((name: string) => Promise.resolve(envListResult.some(e => e.Name === name))),
        envGetValues: mock.fn(() => Promise.resolve({})),
        show: mock.fn(() => Promise.resolve(undefined)),
        provisionWithCapture: mock.fn(() => Promise.resolve(defaultProvisionCaptureResult())),
        deployWithCapture: mock.fn(() => Promise.resolve(defaultDeployCaptureResult())),
    };
}
