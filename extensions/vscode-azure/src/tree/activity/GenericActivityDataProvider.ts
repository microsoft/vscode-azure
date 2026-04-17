/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DataProvider, type DataProviderChangeEvent, type Disposable, EventEmitter } from '@microsoft/vscode-azure-utils';
import { injectable } from 'inversify';
import { type Activity, isActivity } from './Activity';

interface GenericActivity extends Activity {
    readonly type: 'generic';
}

/**
 * Data-layer provider for simple, flat {@linkcode Activity} items that are
 * pushed imperatively by commands (e.g. long-running CLI operations).
 *
 * Activities are tracked via {@linkcode trackActivity} and updated in-place
 * via {@linkcode updateActivity}; change events are fired so the tree
 * re-renders. These activities do not have children.
 */
@injectable()
export class GenericActivityDataProvider implements DataProvider<GenericActivity>, Disposable {
    public readonly isRoot = true;

    private readonly rootActivities = new Map<string, GenericActivity>();

    private readonly onDidChangeEmitter = new EventEmitter<DataProviderChangeEvent<GenericActivity>>();
    public readonly onDidChange = this.onDidChangeEmitter.event;

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is GenericActivity {
        return isActivity(resource) && resource.type === 'generic';
    }

    /** @inheritdoc */
    public getChildren(resource?: GenericActivity): Promise<GenericActivity[]> {
        if (!resource) {
            return Promise.resolve([...this.rootActivities.values()]);
        }
        return Promise.resolve([]);
    }

    /**
     * Add a new generic activity to the tree. The `type` and `startTime`
     * are assigned automatically. Returns the fully-populated activity so
     * callers can mutate it later (e.g. set `status`/`endTime`).
     */
    public trackActivity(activity: Omit<GenericActivity, 'type' | 'startTime'>): GenericActivity {
        const full: GenericActivity = {
            ...activity,
            type: 'generic',
            startTime: new Date(),
        };
        this.rootActivities.set(full.id, full);
        this.onDidChangeEmitter.fire({ includeChildren: true });
        return full;
    }

    /**
     * Apply a partial update to an existing activity and fire `onDidChange`
     * so the tree re-renders. No-op if `id` is unknown.
     */
    public updateActivity(id: string, changes: Partial<Pick<GenericActivity, 'status' | 'title' | 'description' | 'endTime'>>): void {
        const activity = this.rootActivities.get(id);
        if (activity) {
            Object.assign(activity, changes);
            this.onDidChangeEmitter.fire({ resource: activity, includeChildren: false });
        }
    }

    /** Remove all root activities matching `filter`. */
    public clearActivities(filter: (activity: GenericActivity) => boolean): void {
        let changed = false;
        for (const [id, activity] of this.rootActivities) {
            if (filter(activity)) {
                this.rootActivities.delete(id);
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
