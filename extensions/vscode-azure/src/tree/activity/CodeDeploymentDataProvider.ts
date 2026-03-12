/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DataProvider } from '@microsoft/vscode-azure-utils';
import { injectable } from 'inversify';
import { type CodeDeploymentActivity, isActivity } from './Activity';

@injectable()
export class CodeDeploymentDataProvider implements DataProvider<CodeDeploymentActivity> {
    public readonly isRoot = true;

    public canHandle(activity: unknown): activity is CodeDeploymentActivity {
        return isActivity(activity) && activity.type === 'codeDeployment';
    }

    public getChildren(activity?: CodeDeploymentActivity): Promise<CodeDeploymentActivity[]> {
        throw new Error('Not implemented');
    }
}
