/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ITreeItem, ViewProvider } from '@microsoft/vscode-azure-utils';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IActivityViewDataTree } from '../../services';
import type { Activity } from './Activity';

@injectable()
export class ActivityViewProvider implements ViewProvider<string> {
    public readonly isRoot = true;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActivityViewDataTree) private readonly dataTree: IActivityViewDataTree,
    ) { }

    public canHandle(_activityId: unknown): _activityId is string {
        return true; // One view provider for all activity types
    }

    public async getChildren(activityId?: string): Promise<string[]> {
        let parentActivity: Activity | undefined;
        if (activityId) {
            parentActivity = this.dataTree.get(activityId);
        }

        const children = await this.dataTree.getChildren(parentActivity);

        return children.map(activity => activity.id);
    }

    public getTreeItem(activityId: string): ITreeItem {
        const activity = this.dataTree.get(activityId);

        if (!activity) {
            // TODO: unexpected
            throw new Error(`Activity with ID ${activityId} not found`);
        }

        const treeItem = new this.code.TreeItem(activity.title, this.code.TreeItemCollapsibleState.Collapsed);
        treeItem.id = activityId;

        switch (activity.status) {
            case 'NotStarted':
                treeItem.iconPath = new this.code.ThemeIcon('circle-large');
                break;
            case 'InProgress':
                treeItem.iconPath = new this.code.ThemeIcon('loading~spin');
                break;
            case 'Completed':
                treeItem.iconPath = new this.code.ThemeIcon('pass', new this.code.ThemeColor('testing.iconPassed'));
                break;
            case 'Failed':
                treeItem.iconPath = new this.code.ThemeIcon('error', new this.code.ThemeColor('testing.iconFailed'));
                break;
        }

        return new this.code.TreeItem(activityId, this.code.TreeItemCollapsibleState.Collapsed);
    }

    public getParent(activityId: string): Promise<string | undefined> {
        throw new Error('Not implemented');
    }
}
