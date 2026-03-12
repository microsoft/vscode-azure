/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface Activity {
    id: string;
    type: string;
    status: 'NotStarted' | 'InProgress' | 'Completed' | 'Failed';
    title: string;
    description?: string;
    startTime: Date;
    endTime?: Date;
}

export interface ArmDeploymentActivity extends Activity {
    type: 'armDeployment';
}

export interface CodeDeploymentActivity extends Activity {
    type: 'codeDeployment';
}

export interface GenericActivity extends Activity {
    type: 'generic';
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
