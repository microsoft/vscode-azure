/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DataProvider } from '@microsoft/vscode-azure-utils';
import { injectable } from 'inversify';
import { type GenericActivity, isActivity } from './Activity';

@injectable()
export class GenericActivityDataProvider implements DataProvider<GenericActivity> {
    public readonly isRoot = true;

    public canHandle(activity: unknown): activity is GenericActivity {
        return isActivity(activity) && activity.type === 'generic';
    }

    public getChildren(activity?: GenericActivity): Promise<GenericActivity[]> {
        throw new Error('Not implemented');
    }
}
