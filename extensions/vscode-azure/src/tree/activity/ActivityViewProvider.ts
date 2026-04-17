/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ITreeItem, ViewProvider } from '@microsoft/vscode-azure-utils';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IActivityViewDataTree } from '../../services';
import type { Activity } from './Activity';

/**
 * General-purpose view provider for activity tree items (generic activities,
 * code deployments, etc.). Handles any activity type that does not have a
 * more specific view provider registered.
 */
@injectable()
export class ActivityViewProvider implements ViewProvider<string> {
    public readonly isRoot = true;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActivityViewDataTree) private readonly dataTree: IActivityViewDataTree,
    ) { }

    /** @inheritdoc */
    public canHandle(activityId: unknown): activityId is string {
        return typeof activityId === 'string';
    }

    /**
     * @inheritdoc
     * @throws if `activityId` is supplied but the matching activity is not
     * present in the data tree cache.
     */
    public async getChildren(activityId?: string): Promise<string[]> {
        let parentActivity: Activity | undefined;
        if (activityId) {
            parentActivity = this.dataTree.get(activityId);

            if (!parentActivity) {
                // TODO: unexpected
                throw new Error(`Activity with ID ${activityId} not found in cache`);
            }
        }

        const children = await this.dataTree.getChildren(parentActivity);
        return children.map(activity => activity.id);
    }

    /**
     * @inheritdoc
     * @throws if the activity is not found in the data tree cache.
     */
    public getTreeItem(activityId: string): ITreeItem {
        const activity = this.dataTree.get(activityId);

        if (!activity) {
            // TODO: unexpected
            throw new Error(`Activity with ID ${activityId} not found`);
        }

        return toActivityTreeItem(this.code, activity, activityId);
    }
}

/**
 * Builds a VS Code tree item for any activity, with status-based icon.
 * Shared by all activity view providers.
 */
export function toActivityTreeItem(code: IVsCode, activity: Activity, activityId: string): ITreeItem {
    const isLeaf = activity.type === 'armDeploymentOperation' || activity.type === 'generic';
    const collapsibleState = isLeaf
        ? code.TreeItemCollapsibleState.None
        : code.TreeItemCollapsibleState.Collapsed;

    const treeItem = new code.TreeItem(activity.title, collapsibleState);
    treeItem.id = activityId;
    treeItem.description = activity.description;

    switch (activity.status) {
        case 'NotStarted':
            treeItem.iconPath = new code.ThemeIcon('circle-large');
            break;
        case 'InProgress':
            treeItem.iconPath = new code.ThemeIcon('loading~spin');
            break;
        case 'Completed':
            treeItem.iconPath = new code.ThemeIcon('pass', new code.ThemeColor('testing.iconPassed'));
            break;
        case 'Canceled':
            treeItem.iconPath = new code.ThemeIcon('circle-slash', new code.ThemeColor('testing.iconSkipped'));
            break;
        case 'Failed':
            treeItem.iconPath = new code.ThemeIcon('error', new code.ThemeColor('testing.iconFailed'));
            break;
    }

    return treeItem;
}
