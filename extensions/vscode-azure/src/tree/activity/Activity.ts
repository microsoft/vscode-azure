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
    /** The ID of the user-initiated root deployment this belongs to. Equal to {@link id} for root deployments. */
    readonly rootDeploymentId: string;
    /** Operations discovered by enrichment. Populated asynchronously after the deployment is loaded. */
    operations?: ArmDeploymentOperationActivity[];
    /** Controller that is aborted when this deployment tree is cleared. Shared by all nested deployments. */
    readonly abortController: AbortController;
}

export interface ArmDeploymentOperationActivity extends Activity {
    readonly type: 'armDeploymentOperation';
    readonly operationId: string;
    /** The full ARM resource ID of the target resource. */
    readonly targetResourceId: string;
    readonly targetResourceType?: string;
    readonly targetResourceName?: string;
    /** The raw ARM provisioning state string (e.g. 'Succeeded', 'Running'). */
    readonly provisioningState?: string;
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

export function isTerminalActivityStatus(status: ActivityStatus): boolean {
    return status === 'Completed' || status === 'Failed' || status === 'Canceled';
}

/**
 * Fired by activity data providers when tracked activities change.
 *
 * @param activity - The activity that changed, or `undefined` for root-level
 *   changes (e.g. a new activity was added).
 * @param childrenChanged - When `true`, the activity's children have
 *   structurally changed (added/removed) and must be re-fetched. When
 *   `false`, only the activity's own properties (status, description)
 *   were mutated in-place.
 */
export interface ActivityChangeEvent {
    readonly activity?: Activity;
    readonly childrenChanged: boolean;
}
