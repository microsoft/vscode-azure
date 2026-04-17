/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

/**
 * In-memory implementation of {@linkcode vscode.Memento} for tests.
 *
 * Backs `extensionContext.workspaceState` and `globalState` in the mock
 * {@linkcode IExtensionContext} produced by `createMockCodeContext`.
 * State is kept in a `Map` and does not persist across instances.
 */
export class MockMemento implements vscode.Memento {
    private readonly store = new Map<string, unknown>();

    /** @inheritdoc */
    keys(): readonly string[] {
        return [...this.store.keys()];
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- matching vscode.Memento signature
    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    /** @inheritdoc */
    get<T>(key: string, defaultValue?: T): T | undefined {
        return this.store.has(key) ? (this.store.get(key) as T) : defaultValue;
    }

    /**
     * @inheritdoc
     *
     * Passing `undefined` removes the key from the store.
     */
    update(key: string, value: unknown): Promise<void> {
        if (value === undefined) {
            this.store.delete(key);
        } else {
            this.store.set(key, value);
        }
        return Promise.resolve();
    }
}
