/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Discriminator for the concrete activity variants. */
export type ActivityType = 'armDeployment' | 'armDeploymentOperation' | 'codeDeployment' | 'generic';

/** Lifecycle state of an {@linkcode Activity}. */
export type ActivityStatus = 'NotStarted' | 'InProgress' | 'Canceled' | 'Completed' | 'Failed';

/**
 * Common shape of all items displayed in the activity tree.
 *
 * Concrete variants (ARM deployments, code deployments, generic activities)
 * extend this with a discriminating {@linkcode type} and additional fields.
 */
export interface Activity {
    readonly id: string;
    readonly type: ActivityType;
    status: ActivityStatus;
    title: string;
    description?: string;
    readonly startTime: Date;
    endTime?: Date;
}

/** Type guard that narrows an unknown value to an {@linkcode Activity}. */
export function isActivity(maybeActivity: unknown): maybeActivity is Activity {
    return !!maybeActivity
        && typeof maybeActivity === 'object'
        && 'id' in maybeActivity
        && 'type' in maybeActivity
        && 'status' in maybeActivity
        && 'title' in maybeActivity
        && 'startTime' in maybeActivity;
}

/** Returns `true` if `status` is a final (non-progressing) state. */
export function isTerminalActivityStatus(status: ActivityStatus): boolean {
    return status === 'Completed' || status === 'Failed' || status === 'Canceled';
}
