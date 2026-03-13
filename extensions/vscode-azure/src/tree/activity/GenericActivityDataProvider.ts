/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DataProvider, type Disposable, EventEmitter } from '@microsoft/vscode-azure-utils';
import { injectable } from 'inversify';
import type { ActivityChangeEvent } from './Activity';
import { type GenericActivity, isActivity } from './Activity';

@injectable()
export class GenericActivityDataProvider implements DataProvider<GenericActivity>, Disposable {
    public readonly isRoot = true;

    private readonly rootActivities = new Map<string, GenericActivity>();

    private readonly onDidChangeEmitter = new EventEmitter<ActivityChangeEvent>();
    public readonly onDidChange = this.onDidChangeEmitter.event;

    public canHandle(resource: unknown): resource is GenericActivity {
        return isActivity(resource) && resource.type === 'generic';
    }

    public getChildren(resource?: GenericActivity): Promise<GenericActivity[]> {
        if (!resource) {
            return Promise.resolve([...this.rootActivities.values()]);
        }
        return Promise.resolve([]);
    }

    public trackActivity(activity: Omit<GenericActivity, 'type' | 'startTime'>): GenericActivity {
        const full: GenericActivity = {
            ...activity,
            type: 'generic',
            startTime: new Date(),
        };
        this.rootActivities.set(full.id, full);
        this.onDidChangeEmitter.fire({ childrenChanged: true });
        return full;
    }

    public updateActivity(id: string, changes: Partial<Pick<GenericActivity, 'status' | 'title' | 'description' | 'endTime'>>): void {
        const activity = this.rootActivities.get(id);
        if (activity) {
            Object.assign(activity, changes);
            this.onDidChangeEmitter.fire({ activity, childrenChanged: false });
        }
    }

    public clearActivities(filter: (activity: GenericActivity) => boolean): void {
        let changed = false;
        for (const [id, activity] of this.rootActivities) {
            if (filter(activity)) {
                this.rootActivities.delete(id);
                changed = true;
            }
        }
        if (changed) {
            this.onDidChangeEmitter.fire({ childrenChanged: true });
        }
    }

    public dispose(): void {
        this.onDidChangeEmitter.dispose();
    }
}
