/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';
import type { ArmDeploymentDataProvider } from '../../../tree/activity/ArmDeploymentDataProvider';
import type { CodeDeploymentDataProvider } from '../../../tree/activity/CodeDeploymentDataProvider';

/** Creates a mock {@linkcode ArmDeploymentDataProvider} with `trackDeployment` backed by `mock.fn()`. */
export function createMockArmProvider(): ArmDeploymentDataProvider & { trackDeployment: ReturnType<typeof mock.fn> } {
    return { trackDeployment: mock.fn() } as never;
}

/** Creates a mock {@linkcode CodeDeploymentDataProvider} with `trackDeployment` returning a handle. */
export function createMockCodeProvider(): CodeDeploymentDataProvider & { trackDeployment: ReturnType<typeof mock.fn> } {
    return {
        trackDeployment: mock.fn(() => ({
            id: 'test-id',
            complete: mock.fn(),
            addChild: mock.fn(),
        })),
    } as never;
}
