/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DataProvider, type DataProviderChangeEvent, type Disposable, EventEmitter, Roots, selfOnly, stringifyError } from '@microsoft/vscode-azure-utils';
import { injectable, type ServiceIdentifier } from 'inversify';
import * as crypto from 'node:crypto';
import { type Activity, type ActivityStatus, isActivity, isTerminalActivityStatus } from './Activity';

/** Identifier for the generic activity data provider */
export const IGenericActivityDataProvider: ServiceIdentifier<GenericActivityDataProvider> = Symbol.for('IGenericActivityDataProvider');
export type IGenericActivityDataProvider = GenericActivityDataProvider;

interface GenericActivity extends Activity {
    readonly type: 'generic';
}

/**
 * Data-layer provider for simple, flat {@linkcode Activity} items that are
 * pushed imperatively by commands (e.g. long-running CLI operations).
 *
 * Activities are tracked via {@linkcode trackActivity}, which returns a
 * {@linkcode GenericActivityHandle} the caller uses to update the activity
 * in-place; change events are fired so the tree re-renders. These activities
 * do not have children.
 */
@injectable()
export class GenericActivityDataProvider implements DataProvider<Activity>, Disposable {
    public readonly isRoot = true;

    private readonly rootActivities = new Map<string, GenericActivity>();

    private readonly onDidChangeEmitter = new EventEmitter<DataProviderChangeEvent<Activity>>();
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
     * are assigned automatically. Returns a {@linkcode GenericActivityHandle}
     * the caller uses to update the activity's status/title/description later.
     */
    public trackActivity(opts: { readonly title: string; readonly status?: ActivityStatus; readonly description?: string }): GenericActivityHandle {
        const status = opts.status ?? 'InProgress';
        const now = new Date();
        const activity: GenericActivity = {
            id: crypto.randomUUID(),
            type: 'generic',
            status,
            title: opts.title,
            description: opts.description,
            startTime: now,
            endTime: isTerminalActivityStatus(status) ? now : undefined,
        };
        this.rootActivities.set(activity.id, activity);
        this.onDidChangeEmitter.fire({ target: Roots });
        return new GenericActivityHandle(activity, (e) => { this.onDidChangeEmitter.fire(e); });
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
            this.onDidChangeEmitter.fire({ target: Roots });
        }
    }

    /** @inheritdoc */
    public dispose(): void {
        this.onDidChangeEmitter.dispose();
    }
}

/**
 * Handle returned by {@linkcode GenericActivityDataProvider.trackActivity}
 * for controlling a generic activity's lifecycle. Mutating the activity
 * through the handle fires `onDidChange` so the tree re-renders.
 */
export class GenericActivityHandle {
    /** The underlying activity ID. */
    public readonly id: string;

    public constructor(
        private readonly activity: GenericActivity,
        private readonly fireChange: (event: DataProviderChangeEvent<Activity>) => void,
    ) {
        this.id = activity.id;
    }

    /**
     * Apply a partial update to the activity and fire `onDidChange` so the
     * tree re-renders.
     *
     * When `changes.status` is a terminal state (Completed/Failed/Canceled/
     * Info/Warn), {@linkcode Activity.endTime endTime} is set automatically.
     * When `changes.error` is provided, its message becomes the activity's
     * {@linkcode Activity.description description} (an explicit `description`
     * takes precedence).
     *
     * @throws if the activity has already reached a terminal state and
     * `changes.status` would move it back to a non-terminal one.
     */
    public update(changes: Partial<Pick<Activity, 'status' | 'title' | 'description'>> & { readonly error?: unknown }): void {
        const { error, ...fields } = changes;

        if (fields.status !== undefined && !isTerminalActivityStatus(fields.status) && isTerminalActivityStatus(this.activity.status)) {
            throw new Error(`Cannot move activity '${this.activity.id}' from terminal status '${this.activity.status}' to '${fields.status}'.`);
        }

        if (error !== undefined) {
            this.activity.description = stringifyError(error);
            // A non-string `description` (e.g. an explicit `undefined`) must not
            // clobber the error-derived message; only a real string wins.
            if (typeof fields.description !== 'string') {
                delete fields.description;
            }
        }

        // An explicit `description` in `changes` takes precedence over `error`.
        Object.assign(this.activity, fields);

        if (fields.status !== undefined && isTerminalActivityStatus(fields.status)) {
            this.activity.endTime = new Date();
        }
        this.fireChange({ target: selfOnly(this.activity) });
    }
}
