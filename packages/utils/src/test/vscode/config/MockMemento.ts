/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

export class MockMemento implements vscode.Memento {
    private readonly store = new Map<string, unknown>();

    keys(): readonly string[] {
        return [...this.store.keys()];
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- matching vscode.Memento signature
    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        return this.store.has(key) ? (this.store.get(key) as T) : defaultValue;
    }

    update(key: string, value: unknown): Promise<void> {
        if (value === undefined) {
            this.store.delete(key);
        } else {
            this.store.set(key, value);
        }
        return Promise.resolve();
    }
}
