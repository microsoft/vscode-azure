/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DataProvider, type DataProviderChangeEvent, type Disposable, EventEmitter, Roots, stringifyError } from '@microsoft/vscode-azure-utils';
import { injectable, type ServiceIdentifier } from 'inversify';
import * as crypto from 'node:crypto';
import { type Activity, type ActivityStatus, isActivity, isTerminalActivityStatus } from './Activity';

/** Identifier for the code deployment data provider */
export const ICodeDeploymentDataProvider: ServiceIdentifier<CodeDeploymentDataProvider> = Symbol.for('ICodeDeploymentDataProvider');
export type ICodeDeploymentDataProvider = CodeDeploymentDataProvider;

interface CodeDeploymentActivity extends Activity {
    readonly type: 'codeDeployment';
    isLeaf?: boolean;
    children?: CodeDeploymentActivity[];
}

/**
 * Data-layer provider for "code deployment" activities (e.g. zip deploys,
 * source control pushes). Supports nested children directly via the
 * activity's {@linkcode CodeDeploymentActivity.children} array rather than
 * through a separate data source.
 */
@injectable()
export class CodeDeploymentDataProvider implements DataProvider<Activity>, Disposable {
    public readonly isRoot = true;

    private readonly rootDeployments = new Map<string, CodeDeploymentActivity>();

    private readonly onDidChangeEmitter = new EventEmitter<DataProviderChangeEvent<Activity>>();
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
        this.onDidChangeEmitter.fire({ target: Roots });
        return new CodeDeploymentHandle(activity, (e) => { this.onDidChangeEmitter.fire(e); });
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
            this.onDidChangeEmitter.fire({ target: Roots });
        }
    }

    /** @inheritdoc */
    public dispose(): void {
        this.onDidChangeEmitter.dispose();
    }
}

/** Options for {@linkcode CodeDeploymentHandle.addChild}. */
export interface AddChildOptions {
    readonly title: string;
    readonly status?: ActivityStatus;
    readonly isLeaf?: boolean;
}

/**
 * Handle returned by {@linkcode CodeDeploymentDataProvider.trackDeployment}
 * for controlling a deployment activity's lifecycle and children.
 */
export class CodeDeploymentHandle {
    /** The underlying activity ID. */
    public readonly id: string;

    public constructor(
        private readonly activity: CodeDeploymentActivity,
        private readonly fireChange: (event: DataProviderChangeEvent<Activity>) => void,
    ) {
        this.id = activity.id;
    }

    /**
     * Append a child activity under this deployment. Returns a child
     * handle whose {@linkcode complete} independently controls that child's
     * status.
     */
    public addChild(opts: AddChildOptions): CodeDeploymentHandle {
        this.activity.isLeaf = false;
        const child: CodeDeploymentActivity = {
            id: crypto.randomUUID(),
            type: 'codeDeployment',
            status: opts.status ?? 'Completed',
            title: opts.title,
            isLeaf: opts.isLeaf,
            startTime: new Date(),
            endTime: isTerminalActivityStatus(opts.status ?? 'Completed') ? new Date() : undefined,
        };
        this.activity.children ??= [];
        this.activity.children.push(child);
        this.fireChange({ target: this.activity });
        return new CodeDeploymentHandle(child, this.fireChange);
    }

    /**
     * Mark this activity (or child) as finished. Sets {@linkcode Activity.status status}
     * and {@linkcode Activity.endTime endTime}. When `error` is provided, a `Failed`
     * child is appended with the error message as its title.
     */
    public complete(status: ActivityStatus, error?: unknown): void {
        this.activity.status = status;
        this.activity.endTime = new Date();
        if (error !== undefined) {
            const message = stringifyError(error);
            const errorChild: CodeDeploymentActivity = {
                id: crypto.randomUUID(),
                type: 'codeDeployment',
                status: 'Failed',
                title: message,
                startTime: new Date(),
                endTime: new Date(),
            };
            this.activity.children ??= [];
            this.activity.children.push(errorChild);
        }

        // Auto-complete any pending descendants with their immediate parent's result
        this.completePendingDescendants(this.activity.children, this.activity.status);

        this.fireChange({ target: this.activity });
    }

    /** Recursively complete any pending descendants with their immediate parent's result. */
    private completePendingDescendants(children: CodeDeploymentActivity[] | undefined, parentStatus: ActivityStatus): void {
        if (!children) {
            return;
        }

        const now = new Date();
        for (const child of children) {
            if (!isTerminalActivityStatus(child.status)) {
                child.status = parentStatus;
                child.endTime = now;
            }
            this.completePendingDescendants(child.children, child.status);
        }
    }
}
