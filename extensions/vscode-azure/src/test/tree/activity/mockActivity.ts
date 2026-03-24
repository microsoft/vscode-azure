/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Activity } from '../../../tree/activity/Activity';

export function makeActivity(overrides?: Partial<Activity>): Activity {
    return {
        id: 'test-activity',
        type: 'generic',
        status: 'InProgress',
        title: 'Test Activity',
        startTime: new Date(),
        ...overrides,
    };
}
