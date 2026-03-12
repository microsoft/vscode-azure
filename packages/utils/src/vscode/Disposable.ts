/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

export type Disposable = vscode.Disposable;

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Disposable {
    export const None: Disposable = { dispose: () => { /* noop */ } } satisfies vscode.Disposable; // The `satisfies` operator also makes sure the interfaces are compatible, without needing a `Satisfies` type check

    export function test(obj: unknown): obj is Disposable {
        return !!obj && typeof obj === 'object' && 'dispose' in obj && typeof obj.dispose === 'function';
    }

    export function from(...disposables: Disposable[]): Disposable {
        return {
            dispose: () => {
                for (const disposable of disposables) {
                    try {
                        disposable.dispose();
                    } catch {
                        // noop
                    }
                }
            },
        };
    }
}
