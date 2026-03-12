/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DataProvider } from '@microsoft/vscode-azure-utils';
import { injectable } from 'inversify';
import { type ArmDeploymentActivity, isActivity } from './Activity';

@injectable()
export class ArmDeploymentDataProvider implements DataProvider<ArmDeploymentActivity> {
    public readonly isRoot = true;

    public canHandle(activity: unknown): activity is ArmDeploymentActivity {
        return isActivity(activity) && activity.type === 'armDeployment';
    }

    public getChildren(activity?: ArmDeploymentActivity): Promise<ArmDeploymentActivity[]> {
        throw new Error('Not implemented');
    }
}
