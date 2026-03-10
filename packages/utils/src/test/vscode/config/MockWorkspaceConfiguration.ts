/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

export class MockWorkspaceConfiguration implements vscode.WorkspaceConfiguration {
    constructor(
        private readonly store: Map<string, unknown>,
        private readonly section: string | undefined,
    ) {}

    private fullKey(key: string): string {
        return this.section ? `${this.section}.${key}` : key;
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- matching vscode.WorkspaceConfiguration signature
    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        const full = this.fullKey(key);
        return this.store.has(full) ? (this.store.get(full) as T) : defaultValue;
    }

    has(key: string): boolean {
        return this.store.has(this.fullKey(key));
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- matching vscode.WorkspaceConfiguration signature
    inspect<T>(key: string): { key: string; workspaceValue?: T } | undefined {
        const full = this.fullKey(key);
        if (!this.store.has(full)) {
            return undefined;
        }
        return { key: full, workspaceValue: this.store.get(full) as T };
    }

    update(key: string, value: unknown): Promise<void> {
        const full = this.fullKey(key);
        if (value === undefined) {
            this.store.delete(full);
        } else {
            this.store.set(full, value);
        }
        return Promise.resolve();
    }
}
