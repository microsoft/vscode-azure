/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Activity, ActivityStatus } from '../tree/activity/Activity';
import { ArmDeploymentDataProvider } from '../tree/activity/ArmDeploymentDataProvider';
import { CodeDeploymentDataProvider } from '../tree/activity/CodeDeploymentDataProvider';
import { GenericActivityDataProvider } from '../tree/activity/GenericActivityDataProvider';
import type { ManagedCommand } from './ManagedCommand';
import { inject, injectable } from 'inversify';

export type ClearMode = 'completed' | 'successful' | 'all';

const terminalStatuses: ReadonlySet<ActivityStatus> = new Set(['Completed', 'Failed', 'Canceled']);

@injectable()
export class ClearActivities implements ManagedCommand {
    public constructor(
        @inject(ArmDeploymentDataProvider) private readonly armProvider: ArmDeploymentDataProvider,
        @inject(CodeDeploymentDataProvider) private readonly codeProvider: CodeDeploymentDataProvider,
        @inject(GenericActivityDataProvider) private readonly genericProvider: GenericActivityDataProvider,
    ) { }

    public execute(mode: ClearMode): void {
        const filter = (activity: Activity) => {
            switch (mode) {
                case 'all':
                    return true;
                case 'completed':
                    return terminalStatuses.has(activity.status);
                case 'successful':
                    return activity.status === 'Completed';
            }
        };

        this.armProvider.clearActivities(filter);
        this.codeProvider.clearActivities(filter);
        this.genericProvider.clearActivities(filter);
    }
}
