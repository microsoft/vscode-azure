/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';

export type ActivityType = 'armDeployment' | 'armDeploymentOperation' | 'codeDeployment' | 'generic';
export type ActivityStatus = 'NotStarted' | 'InProgress' | 'Canceled' | 'Completed' | 'Failed';

export interface Activity {
    readonly id: string;
    readonly type: ActivityType;
    status: ActivityStatus;
    title: string;
    description?: string;
    readonly startTime: Date;
    endTime?: Date;
    readonly parentId?: string;
}

export interface ArmDeploymentActivity extends Activity {
    readonly type: 'armDeployment';
    readonly deploymentId: string;
    readonly subscription: AzureSubscription;
    /** The ARM scope prefix (everything before `/providers/Microsoft.Resources/deployments/`). */
    readonly scope: string;
    readonly deploymentName: string;
}

export interface ArmDeploymentOperationActivity extends Activity {
    readonly type: 'armDeploymentOperation';
    readonly operationId: string;
    readonly targetResourceType?: string;
    readonly targetResourceName?: string;
    readonly parentId: string;
}

export interface CodeDeploymentActivity extends Activity {
    readonly type: 'codeDeployment';
}

export interface GenericActivity extends Activity {
    readonly type: 'generic';
}

export function isActivity(maybeActivity: unknown): maybeActivity is Activity {
    return !!maybeActivity
        && typeof maybeActivity === 'object'
        && 'id' in maybeActivity
        && 'type' in maybeActivity
        && 'status' in maybeActivity
        && 'title' in maybeActivity
        && 'startTime' in maybeActivity;
}
