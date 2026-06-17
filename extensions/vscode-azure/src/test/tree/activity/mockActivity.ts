/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Activity } from '../../../tree/activity/Activity';
import type { ArmDeploymentActivity, ArmDeploymentOperationActivity } from '../../../tree/activity/ArmDeploymentDataProvider';

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

export function makeArmDeploymentActivity(overrides?: Partial<ArmDeploymentActivity>): ArmDeploymentActivity {
    return makeActivity({
        id: '/subscriptions/sub/providers/Microsoft.Resources/deployments/d1',
        type: 'armDeployment',
        title: 'd1',
        deploymentId: '/subscriptions/sub/providers/Microsoft.Resources/deployments/d1',
        subscriptionId: 'sub',
        scope: '/subscriptions/sub',
        deploymentName: 'd1',
        rootDeploymentId: '/subscriptions/sub/providers/Microsoft.Resources/deployments/d1',
        abortController: new AbortController(),
        ...overrides,
    }) as ArmDeploymentActivity;
}

export function makeOperationActivity(overrides?: Partial<ArmDeploymentOperationActivity>): ArmDeploymentOperationActivity {
    return makeActivity({
        id: '/subscriptions/sub/providers/Microsoft.Resources/deployments/d1/operations/op1',
        type: 'armDeploymentOperation',
        title: 'sa1',
        operationId: 'op1',
        targetResourceId: '/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.Storage/storageAccounts/sa1',
        targetResourceType: 'Microsoft.Storage/storageAccounts',
        targetResourceName: 'sa1',
        ...overrides,
    }) as ArmDeploymentOperationActivity;
}
