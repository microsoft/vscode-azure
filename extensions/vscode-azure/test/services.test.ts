/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IExtensionContext } from '@microsoft/vscode-azure-utils';
import { mock } from 'node:test';
import { pushDisposable } from '../src/services';

describe('pushDisposable (unit)', () => {
    function createResolutionContext(subscriptions: Disposable[]) {
        return {
            get: (id: unknown) => {
                if (id === IExtensionContext) {
                    return { subscriptions } as never;
                }
                return undefined;
            },
        } as never;
    }

    it('should push a Disposable to context subscriptions', () => {
        const subscriptions: Disposable[] = [];
        const ctx = createResolutionContext(subscriptions);
        const disposable = { dispose: mock.fn() };

        const result = pushDisposable(ctx, disposable);

        expect(subscriptions).to.have.length(1);
        expect(subscriptions[0]).to.equal(disposable);
        expect(result).to.equal(disposable);
    });

    it('should not push a non-Disposable object', () => {
        const subscriptions: Disposable[] = [];
        const ctx = createResolutionContext(subscriptions);
        const nonDisposable = { name: 'test' };

        const result = pushDisposable(ctx, nonDisposable);

        expect(subscriptions).to.have.length(0);
        expect(result).to.equal(nonDisposable);
    });

    it('should not push a primitive value', () => {
        const subscriptions: Disposable[] = [];
        const ctx = createResolutionContext(subscriptions);

        const result = pushDisposable(ctx, 42);

        expect(subscriptions).to.have.length(0);
        expect(result).to.equal(42);
    });
});
