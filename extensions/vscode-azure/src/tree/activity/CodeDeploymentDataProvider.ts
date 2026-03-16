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

@injectable()
export class CodeDeploymentDataProvider implements DataProvider<CodeDeploymentActivity>, Disposable {
    public readonly isRoot = true;

    private readonly rootDeployments = new Map<string, CodeDeploymentActivity>();

    private readonly onDidChangeEmitter = new EventEmitter<DataProviderChangeEvent<CodeDeploymentActivity>>();
    public readonly onDidChange = this.onDidChangeEmitter.event;

    public canHandle(resource: unknown): resource is CodeDeploymentActivity {
        return isActivity(resource) && resource.type === 'codeDeployment';
    }

    public getChildren(resource?: CodeDeploymentActivity): Promise<CodeDeploymentActivity[]> {
        if (!resource) {
            return Promise.resolve([...this.rootDeployments.values()]);
        }
        return Promise.resolve(resource.children ?? []);
    }

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

    public dispose(): void {
        this.onDidChangeEmitter.dispose();
    }
}
