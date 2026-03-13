/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DataProvider, type Disposable, EventEmitter } from '@microsoft/vscode-azure-utils';
import { injectable } from 'inversify';
import type { ActivityChangeEvent } from './Activity';
import { type CodeDeploymentActivity, isActivity } from './Activity';

@injectable()
export class CodeDeploymentDataProvider implements DataProvider<CodeDeploymentActivity>, Disposable {
    public readonly isRoot = true;

    private readonly deployments = new Map<string, CodeDeploymentActivity>();
    private readonly subSteps = new Map<string, CodeDeploymentActivity[]>();

    private readonly onDidChangeEmitter = new EventEmitter<ActivityChangeEvent>();
    public readonly onDidChange = this.onDidChangeEmitter.event;

    public canHandle(resource: unknown): resource is CodeDeploymentActivity {
        return isActivity(resource) && resource.type === 'codeDeployment';
    }

    public getChildren(resource?: CodeDeploymentActivity): Promise<CodeDeploymentActivity[]> {
        if (!resource) {
            return Promise.resolve([...this.deployments.values()]);
        }
        return Promise.resolve(this.subSteps.get(resource.id) ?? []);
    }

    public trackDeployment(activity: Omit<CodeDeploymentActivity, 'type' | 'startTime'>): CodeDeploymentActivity {
        const full: CodeDeploymentActivity = {
            ...activity,
            type: 'codeDeployment',
            startTime: new Date(),
        };
        this.deployments.set(full.id, full);
        this.onDidChangeEmitter.fire({ childrenChanged: true });
        return full;
    }

    public clearActivities(filter: (activity: CodeDeploymentActivity) => boolean): void {
        let changed = false;
        for (const [id, activity] of this.deployments) {
            if (filter(activity)) {
                this.deployments.delete(id);
                this.subSteps.delete(id);
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
