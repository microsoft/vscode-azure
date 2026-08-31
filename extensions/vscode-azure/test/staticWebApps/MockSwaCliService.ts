/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';
import type { SWACLIOptions } from '../../src/staticWebApps/SwaCliConfig';
import type { ISwaCliService } from '../../src/staticWebApps/SwaCliService';

/**
 * A mock {@linkcode ISwaCliService} with all methods backed by `mock.fn()`.
 * The intersection with `ISwaCliService` means it can be passed directly
 * to production code without casts.
 */
export type MockSwaCliService = ISwaCliService & {
    [K in keyof ISwaCliService]: ReturnType<typeof mock.fn>;
};

/**
 * Creates a mock {@linkcode ISwaCliService} suitable for unit tests.
 *
 * @param detectResult - The layout to return from `detect()`. Defaults to a
 *   single-page app at the repository root with no API and no build output.
 */
export function createMockSwaCliService(detectResult: SWACLIOptions = { appLocation: '/' }): MockSwaCliService {
    return {
        detect: mock.fn(() => Promise.resolve(detectResult)),
        checkVersion: mock.fn(() => Promise.resolve(true)),
    };
}
