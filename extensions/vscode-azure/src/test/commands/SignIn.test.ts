/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { makeAccount, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { Everything, Roots } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import { SignIn } from '../../commands/SignIn';
import type { IAzureViewDataTree } from '../../services';

describe('SignIn (unit)', () => {
    function createTree(
        rootChildren: ConcreteAzureNode[],
        childrenMap = new Map<ConcreteAzureNode, ConcreteAzureNode[]>(),
    ): { cache: IAzureViewDataTree; invalidate: ReturnType<typeof mock.fn> } {
        const getChildren = mock.fn((node?: ConcreteAzureNode): Promise<ConcreteAzureNode[]> => {
            if (!node) {
                return Promise.resolve(rootChildren);
            }
            return Promise.resolve(childrenMap.get(node) ?? []);
        });

        const invalidate = mock.fn();
        return {
            cache: {
                getChildren,
                hasMore: () => false,
                loadMore: () => Promise.resolve(),
                invalidate,
            } as unknown as IAzureViewDataTree,
            invalidate,
        };
    }

    /** A minimal stand-in session; the production code never inspects its shape. */
    const fakeSession: unknown = {};

    it('should perform a default sign-in and invalidate roots when signed out', async () => {
        const { cache, invalidate } = createTree([]);
        const { ctx, mock: mockResult } = createMockCodeContext();

        const command = new SignIn(ctx, cache);
        await command.execute();

        const calls = mockResult.authentication.getSession.mock.calls;
        expect(calls.length).to.equal(1);
        const [, scopes, options] = calls[0].arguments as [string, string[], { createIfNone?: boolean }];
        expect(scopes).to.have.length(1);
        expect(options.createIfNone).to.be.true;

        expect(invalidate.mock.callCount()).to.equal(1);
        expect(invalidate.mock.calls[0].arguments[0]).to.equal(Roots);
    });

    it('should sign in to a selected tenant when already signed in', async () => {
        const account = makeAccount({ id: 'acct-1', label: 'Account One' });
        const tenant1 = makeTenant({ tenantId: 'tenant-1', displayName: 'Tenant One', accountId: account.id });
        const tenant2 = makeTenant({ tenantId: 'tenant-2', displayName: 'Tenant Two', accountId: account.id });
        const { cache, invalidate } = createTree([account], new Map<ConcreteAzureNode, ConcreteAzureNode[]>([
            [account, [tenant1, tenant2]],
        ]));

        const { ctx, mock: mockResult } = createMockCodeContext();
        respondToPrompts(mockResult, [{ pick: 'Tenant Two (tenant-2)' }]);

        const command = new SignIn(ctx, cache);
        await command.execute();

        // Already signed in, so only the tenant-scoped sign-in happens.
        const calls = mockResult.authentication.getSession.mock.calls;
        expect(calls.length).to.equal(1);
        const [, scopes, options] = calls[0].arguments as [string, string[], { createIfNone?: boolean; account?: { id: string } }];
        expect(scopes).to.include('VSCODE_TENANT:tenant-2');
        expect(options.createIfNone).to.be.true;
        expect(options.account?.id).to.equal('acct-1');

        // A known account => invalidate just that account's subtree (a selector
        // function), not Roots/Everything.
        expect(invalidate.mock.callCount()).to.equal(1);
        const target = invalidate.mock.calls[0].arguments[0];
        expect(target).to.be.a('function');
        expect(target).to.not.equal(Roots);
        expect(target).to.not.equal(Everything);
    });

    it('should sign in to a typed tenant ID when already signed in', async () => {
        const account = makeAccount({ id: 'acct-1', label: 'Account One' });
        const tenant1 = makeTenant({ tenantId: 'tenant-1', displayName: 'Tenant One', accountId: account.id });
        const { cache, invalidate } = createTree([account], new Map<ConcreteAzureNode, ConcreteAzureNode[]>([
            [account, [tenant1]],
        ]));

        // Tenant IDs are GUIDs (users paste them), so the combobox only offers a
        // synthetic "sign in to <id>" item for a GUID value.
        const typedTenantId = 'aaaaaaaa-1111-2222-3333-444455556666';
        const { ctx, mock: mockResult } = createMockCodeContext();
        respondToPrompts(mockResult, [{ value: typedTenantId }]);

        const command = new SignIn(ctx, cache);
        await command.execute();

        const calls = mockResult.authentication.getSession.mock.calls;
        expect(calls.length).to.equal(1);
        const [, scopes, options] = calls[0].arguments as [string, string[], { createIfNone?: boolean; account?: { id: string } }];
        expect(scopes).to.include(`VSCODE_TENANT:${typedTenantId}`);
        expect(options.createIfNone).to.be.true;
        expect(options.account).to.be.undefined;

        // A typed tenant has no known account => invalidate everything.
        expect(invalidate.mock.callCount()).to.equal(1);
        expect(invalidate.mock.calls[0].arguments[0]).to.equal(Everything);
    });

    it('should offer a tenant sign-in when default sign-in fails', async () => {
        const { cache, invalidate } = createTree([]);
        const { ctx, mock: mockResult } = createMockCodeContext();

        // Default sign-in (no VSCODE_TENANT scope) fails; the tenant-scoped
        // sign-in succeeds.
        mockResult.authentication.getSession.mock.mockImplementation(((_id: string, scopes: readonly string[]) => {
            return scopes.some(s => s.startsWith('VSCODE_TENANT:'))
                ? Promise.resolve(fakeSession)
                : Promise.reject(new Error('conditional access blocked'));
        }) as unknown as typeof mockResult.authentication.getSession);

        // The user accepts the "enter tenant ID" recovery prompt and pastes a
        // tenant GUID.
        const manualTenantId = 'bbbbbbbb-1111-2222-3333-444455556666';
        mockResult.messageResponses.push('Enter Tenant ID');
        respondToPrompts(mockResult, [{ value: manualTenantId }]);

        const command = new SignIn(ctx, cache);
        await command.execute();

        expect(mockResult.window.showWarningMessage.mock.callCount()).to.equal(1);

        const calls = mockResult.authentication.getSession.mock.calls;
        expect(calls.length).to.equal(2);
        const [, scopes, options] = calls[1].arguments as [string, string[], { account?: { id: string } }];
        expect(scopes).to.include(`VSCODE_TENANT:${manualTenantId}`);
        expect(options.account).to.be.undefined;

        expect(invalidate.mock.callCount()).to.equal(1);
        expect(invalidate.mock.calls[0].arguments[0]).to.equal(Everything);
    });

    it('should do nothing more when the user declines the tenant sign-in fallback', async () => {
        const { cache, invalidate } = createTree([]);
        const { ctx, mock: mockResult } = createMockCodeContext();

        mockResult.authentication.getSession.mock.mockImplementation((): Promise<never> => Promise.reject(new Error('conditional access blocked')));
        // No message response queued => the recovery prompt is dismissed.

        const command = new SignIn(ctx, cache);
        await command.execute();

        // Only the failed default sign-in was attempted.
        expect(mockResult.authentication.getSession.mock.calls.length).to.equal(1);
        expect(invalidate.mock.callCount()).to.equal(0);
    });
});
