/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DataProvider, type Disposable, EventEmitter } from '@microsoft/vscode-azure-utils';
import { injectable } from 'inversify';
import { type GenericActivity, isActivity } from './Activity';

@injectable()
export class GenericActivityDataProvider implements DataProvider<GenericActivity>, Disposable {
    public readonly isRoot = true;

    private readonly activities = new Map<string, GenericActivity>();

    private readonly onDidChangeEmitter = new EventEmitter<void>();
    public readonly onDidChange = this.onDidChangeEmitter.event;

    public canHandle(resource: unknown): resource is GenericActivity {
        return isActivity(resource) && resource.type === 'generic';
    }

    public getChildren(resource?: GenericActivity): Promise<GenericActivity[]> {
        if (!resource) {
            return Promise.resolve([...this.activities.values()]);
        }
        return Promise.resolve([]);
    }

    public trackActivity(activity: Omit<GenericActivity, 'type' | 'startTime'>): GenericActivity {
        const full: GenericActivity = {
            ...activity,
            type: 'generic',
            startTime: new Date(),
        };
        this.activities.set(full.id, full);
        this.onDidChangeEmitter.fire();
        return full;
    }

    public updateActivity(id: string, changes: Partial<Pick<GenericActivity, 'status' | 'title' | 'description' | 'endTime'>>): void {
        const activity = this.activities.get(id);
        if (activity) {
            Object.assign(activity, changes);
            this.onDidChangeEmitter.fire();
        }
    }

    public dispose(): void {
        this.onDidChangeEmitter.dispose();
    }
}
