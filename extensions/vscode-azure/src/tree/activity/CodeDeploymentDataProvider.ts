/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DataProvider, type DataProviderChangeEvent, type Disposable, EventEmitter } from '@microsoft/vscode-azure-utils';
import * as crypto from 'crypto';
import { injectable } from 'inversify';
import { type Activity, type ActivityStatus, isActivity } from './Activity';

interface CodeDeploymentActivity extends Activity {
    readonly type: 'codeDeployment';
    children?: CodeDeploymentActivity[];
}

/**
 * Handle returned by {@linkcode CodeDeploymentDataProvider.trackDeployment}
 * for controlling a deployment activity's lifecycle and children.
 */
export interface CodeDeploymentHandle {
    /** The underlying activity ID. */
    readonly id: string;

    /**
     * Append a child activity under this deployment. Returns a child
     * handle whose {@linkcode complete} independently controls that child's
     * status.
     */
    addChild(title: string, status?: ActivityStatus): CodeDeploymentHandle;

    /**
     * Mark this activity (or child) as finished. Sets {@linkcode Activity.status status}
     * and {@linkcode Activity.endTime endTime}. When `error` is provided, a `Failed`
     * child is appended with the error message as its title.
     */
    complete(status: ActivityStatus, error?: unknown): void;
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
     * are assigned automatically. Returns a {@linkcode CodeDeploymentHandle}
     * for controlling the activity's lifecycle and adding children.
     */
    public trackDeployment(opts: { readonly title: string; readonly status?: ActivityStatus }): CodeDeploymentHandle {
        const activity: CodeDeploymentActivity = {
            id: crypto.randomUUID(),
            type: 'codeDeployment',
            status: opts.status ?? 'InProgress',
            title: opts.title,
            startTime: new Date(),
        };
        this.rootDeployments.set(activity.id, activity);
        this.onDidChangeEmitter.fire({ includeChildren: true });
        return this.createHandle(activity);
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

    private createHandle(activity: CodeDeploymentActivity): CodeDeploymentHandle {
        return {
            id: activity.id,
            addChild: (title: string, status: ActivityStatus = 'InProgress'): CodeDeploymentHandle => {
                const child: CodeDeploymentActivity = {
                    id: crypto.randomUUID(),
                    type: 'codeDeployment',
                    status,
                    title,
                    startTime: new Date(),
                };
                activity.children ??= [];
                activity.children.push(child);
                this.onDidChangeEmitter.fire({ resource: activity, includeChildren: true });
                return this.createHandle(child);
            },
            complete: (status: ActivityStatus, error?: unknown): void => {
                activity.status = status;
                activity.endTime = new Date();
                if (error !== undefined) {
                    // eslint-disable-next-line @typescript-eslint/no-base-to-string
                    const message = error instanceof Error ? error.message : String(error);
                    const errorChild: CodeDeploymentActivity = {
                        id: crypto.randomUUID(),
                        type: 'codeDeployment',
                        status: 'Failed',
                        title: message,
                        startTime: new Date(),
                        endTime: new Date(),
                    };
                    activity.children ??= [];
                    activity.children.push(errorChild);
                    this.onDidChangeEmitter.fire({ resource: activity, includeChildren: true });
                } else {
                    this.onDidChangeEmitter.fire({ resource: activity, includeChildren: false });
                }
            },
        };
    }

    /** @inheritdoc */
    public dispose(): void {
        this.onDidChangeEmitter.dispose();
    }
}
