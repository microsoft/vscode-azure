/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
