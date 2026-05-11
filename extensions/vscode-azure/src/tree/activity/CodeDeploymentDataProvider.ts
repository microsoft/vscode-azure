/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DataProvider, type DataProviderChangeEvent, type Disposable, EventEmitter } from '@microsoft/vscode-azure-utils';
import { injectable } from 'inversify';
import { type Activity, isActivity } from './Activity';

interface CodeDeploymentActivity extends Activity {
    readonly type: 'codeDeployment';
    children?: CodeDeploymentActivity[];
}

/**
 * Data-layer provider for "code deployment" activities (e.g. zip deploys,
 * source control pushes). Supports nested children directly via the
 * activity's {@linkcode CodeDeploymentActivity.children} array rather than
 * through a separate data source.
 */
@injectable()
export class CodeDeploymentDataProvider implements DataProvider<CodeDeploymentActivity>, Disposable {
    public readonly isRoot = true;

    private readonly rootDeployments = new Map<string, CodeDeploymentActivity>();

    private readonly onDidChangeEmitter = new EventEmitter<DataProviderChangeEvent<CodeDeploymentActivity>>();
    public readonly onDidChange = this.onDidChangeEmitter.event;

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is CodeDeploymentActivity {
        return isActivity(resource) && resource.type === 'codeDeployment';
    }

    /** @inheritdoc */
    public getChildren(resource?: CodeDeploymentActivity): Promise<CodeDeploymentActivity[]> {
        if (!resource) {
            return Promise.resolve([...this.rootDeployments.values()]);
        }
        return Promise.resolve(resource.children ?? []);
    }

    /**
     * Register a new root code deployment. The `type` and `startTime`
     * are assigned automatically. Returns the created activity.
     */
    public trackDeployment(activity: Omit<CodeDeploymentActivity, 'type' | 'startTime'>): CodeDeploymentActivity {
        const full: CodeDeploymentActivity = {
            ...activity,
            type: 'codeDeployment',
            startTime: new Date(),
        };
        this.rootDeployments.set(full.id, full);
        this.onDidChangeEmitter.fire({ includeChildren: true });
        return full;
    }

    /** Notify the tree that an activity has changed. */
    public fireDidChange(activity: CodeDeploymentActivity): void {
        this.onDidChangeEmitter.fire({ resource: activity, includeChildren: false });
    }

    /** Remove all root code deployments matching `filter`. */
    public clearActivities(filter: (activity: CodeDeploymentActivity) => boolean): void {
        let changed = false;
        for (const [id, activity] of this.rootDeployments) {
            if (filter(activity)) {
                this.rootDeployments.delete(id);
                changed = true;
            }
        }
        if (changed) {
            this.onDidChangeEmitter.fire({ includeChildren: true });
        }
    }

    /** @inheritdoc */
    public dispose(): void {
        this.onDidChangeEmitter.dispose();
    }
}
