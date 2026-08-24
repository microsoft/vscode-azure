/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { inject, injectable } from 'inversify';
import { isTerminalActivityStatus, type Activity } from '../../tree/activity/Activity';
import { IArmDeploymentDataProvider } from '../../tree/activity/ArmDeploymentDataProvider';
import { ICodeDeploymentDataProvider } from '../../tree/activity/CodeDeploymentDataProvider';
import { IGenericActivityDataProvider } from '../../tree/activity/GenericActivityDataProvider';
import type { ManagedCommand } from '../ManagedCommand';

type ClearMode = 'completed' | 'successful' | 'all';

/**
 * Clears activities from all activity tree providers. The prefix arg
 * supplied at registration selects the set to clear:
 * - `'completed'`  -- any activity in a terminal status (success or failure).
 * - `'successful'` -- only activities that completed successfully.
 * - `'all'`        -- every activity, including still-running ones.
 */
@injectable()
export class ClearActivities implements ManagedCommand {
    public constructor(
        @inject(IArmDeploymentDataProvider) private readonly armProvider: IArmDeploymentDataProvider,
        @inject(ICodeDeploymentDataProvider) private readonly codeProvider: ICodeDeploymentDataProvider,
        @inject(IGenericActivityDataProvider) private readonly genericProvider: IGenericActivityDataProvider,
    ) { }

    public execute(mode: ClearMode): void {
        const filter = (activity: Activity) => {
            switch (mode) {
                case 'all':
                    return true;
                case 'completed':
                    return isTerminalActivityStatus(activity.status);
                case 'successful':
                    return activity.status === 'Completed';
            }
        };

        this.armProvider.clearActivities(filter);
        this.codeProvider.clearActivities(filter);
        this.genericProvider.clearActivities(filter);
    }
}
