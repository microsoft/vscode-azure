/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';
import type { AzdEnvironment, IAzdService } from '../../src/azd/AzdService';

/**
 * A mock {@linkcode IAzdService} with all methods backed by `mock.fn()`.
 * The intersection with `IAzdService` means it can be passed directly
 * to production code without casts.
 */
export type MockAzdService = IAzdService & {
    [K in keyof IAzdService]: ReturnType<typeof mock.fn>;
};

/**
 * Creates a mock {@linkcode IAzdService} suitable for unit tests.
 *
 * @param envListResult - The result to return from `envList()`. Defaults to `[]`.
 */
export function createMockAzdService(envListResult: AzdEnvironment[] = []): MockAzdService {
    return {
        findAzureYaml: mock.fn(() => Promise.resolve([])),
        updateAzureYaml: mock.fn(() => Promise.resolve()),
        init: mock.fn(() => Promise.resolve()),
        envNew: mock.fn(() => Promise.resolve()),
        envList: mock.fn(() => Promise.resolve(envListResult)),
        envExists: mock.fn((name: string) => Promise.resolve(envListResult.some(e => e.Name === name))),
        envGetValues: mock.fn(() => Promise.resolve({})),
        show: mock.fn(() => Promise.resolve(undefined)),
        provision: mock.fn(() => Promise.resolve()),
        deploy: mock.fn(() => Promise.resolve()),
        pipelineConfig: mock.fn(() => Promise.resolve()),
        down: mock.fn(() => Promise.resolve()),
        checkVersion: mock.fn(() => Promise.resolve(true)),
    };
}
