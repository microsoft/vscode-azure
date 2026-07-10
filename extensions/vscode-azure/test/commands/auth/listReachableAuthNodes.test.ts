/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { createMockPagedDataItemTree, makeAccount, makeSubscription, makeTenant, pagedChildren } from '@microsoft/vscode-azure-azutils/testing';
import { expect } from 'chai';
import { listReachableSubscriptions } from '../../../src/commands/auth/listReachableAuthNodes';

describe('listReachableAuthNodes (unit)', () => {
    describe('listReachableSubscriptions', () => {
        it('drills account -> tenant -> subscription and returns them sorted with no failures', async () => {
            const account = makeAccount({ id: 'acct-1' });
            const tenant = makeTenant({ tenantId: 'tenant-1', accountId: account.id });
            // Provided out of alphabetical order to prove the result is sorted by displayName.
            const subBeta = makeSubscription({ subscriptionId: 'sub-b', displayName: 'Beta', tenantId: tenant.tenantId, accountId: account.id });
            const subAlpha = makeSubscription({ subscriptionId: 'sub-a', displayName: 'Alpha', tenantId: tenant.tenantId, accountId: account.id });
            const { tree } = createMockPagedDataItemTree([account], pagedChildren([
                [account, [[tenant]]],
                [tenant, [[subBeta, subAlpha]]],
            ]));

            const { subscriptions, failures } = await listReachableSubscriptions(tree);

            expect(failures).to.deep.equal([]);
            expect(subscriptions.map(s => s.subscription.displayName)).to.deep.equal(['Alpha', 'Beta']);
            // The account/tenant that reached each subscription are threaded through.
            expect(subscriptions[0].account).to.equal(account);
            expect(subscriptions[0].tenant).to.equal(tenant);
        });

        it('returns empty results for a tree with no accounts', async () => {
            const { tree } = createMockPagedDataItemTree([], pagedChildren([]));

            const { subscriptions, failures } = await listReachableSubscriptions(tree);

            expect(subscriptions).to.deep.equal([]);
            expect(failures).to.deep.equal([]);
        });

        it('drains every page of a tenant and dedups a subscription repeated across pages', async () => {
            const account = makeAccount({ id: 'acct-1' });
            const tenant = makeTenant({ tenantId: 'tenant-1', accountId: account.id });
            const sub = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Only', tenantId: tenant.tenantId, accountId: account.id });
            // The same subscription is served on two separate pages.
            const { tree, loadMore } = createMockPagedDataItemTree([account], pagedChildren([
                [account, [[tenant]]],
                [tenant, [[sub], [sub]]],
            ]));

            const { subscriptions, failures } = await listReachableSubscriptions(tree);

            expect(failures).to.deep.equal([]);
            expect(subscriptions).to.have.lengthOf(1);
            // Paging advanced to pull the second page (otherwise the walk would stop at page one).
            expect(loadMore.mock.callCount()).to.equal(1);
        });

        it('dedups case-insensitively via subscriptionFilterKey across differently-cased ids', async () => {
            const account = makeAccount({ id: 'acct-1' });
            const tenantLower = makeTenant({ tenantId: 'tenant-1', accountId: account.id });
            const tenantUpper = makeTenant({ tenantId: 'TENANT-1', accountId: account.id });
            const subLower = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Sub', tenantId: 'tenant-1', accountId: account.id });
            const subUpper = makeSubscription({ subscriptionId: 'SUB-1', displayName: 'Sub', tenantId: 'TENANT-1', accountId: account.id });
            const { tree } = createMockPagedDataItemTree([account], pagedChildren([
                [account, [[tenantLower, tenantUpper]]],
                [tenantLower, [[subLower]]],
                [tenantUpper, [[subUpper]]],
            ]));

            const { subscriptions } = await listReachableSubscriptions(tree);

            // 'tenant-1/sub-1' and 'TENANT-1/SUB-1' collapse to the same key.
            expect(subscriptions).to.have.lengthOf(1);
            expect(subscriptions[0].tenant).to.equal(tenantLower);
        });

        it('skips nodes that are not accounts, tenants, or subscriptions at each level', async () => {
            const account = makeAccount({ id: 'acct-1' });
            const tenant = makeTenant({ tenantId: 'tenant-1', accountId: account.id });
            const sub = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Real', tenantId: tenant.tenantId, accountId: account.id });
            // Wrong-typed stray nodes seeded at each level; all should be ignored.
            const strayAtRoot = makeSubscription({ subscriptionId: 'stray-root', tenantId: 'tenant-1', accountId: account.id });
            const strayUnderAccount = makeSubscription({ subscriptionId: 'stray-acct', tenantId: 'tenant-1', accountId: account.id });
            const strayUnderTenant = makeTenant({ tenantId: 'stray-tenant', accountId: account.id });
            const { tree } = createMockPagedDataItemTree(
                [strayAtRoot, account],
                pagedChildren([
                    [account, [[strayUnderAccount, tenant]]],
                    [tenant, [[strayUnderTenant, sub]]],
                ]),
            );

            const { subscriptions, failures } = await listReachableSubscriptions(tree);

            expect(failures).to.deep.equal([]);
            expect(subscriptions.map(s => s.subscription.subscriptionId)).to.deep.equal(['sub-1']);
        });

        it('captures a failing tenant in failures without aborting the rest of the walk', async () => {
            const account = makeAccount({ id: 'acct-1' });
            const goodTenant = makeTenant({ tenantId: 'good', accountId: account.id });
            const badTenant = makeTenant({ tenantId: 'bad', accountId: account.id });
            const sub = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Good Sub', tenantId: goodTenant.tenantId, accountId: account.id });
            const { tree } = createMockPagedDataItemTree(
                [account],
                pagedChildren([
                    [account, [[goodTenant, badTenant]]],
                    [goodTenant, [[sub]]],
                ]),
                { failNodes: new Set<ConcreteAzureNode>([badTenant]) },
            );

            const { subscriptions, failures } = await listReachableSubscriptions(tree);

            // The good tenant's subscription still comes through...
            expect(subscriptions.map(s => s.subscription.subscriptionId)).to.deep.equal(['sub-1']);
            // ...and the bad tenant is recorded as a failure carrying the tenant that threw.
            expect(failures).to.have.lengthOf(1);
            expect(failures[0].account).to.equal(account);
            expect(failures[0].tenant).to.equal(badTenant);
            expect(failures[0].error).to.be.instanceOf(Error);
        });

        it('captures a failing account tenant-list (tenant undefined) and still walks other accounts', async () => {
            const badAccount = makeAccount({ id: 'bad-acct' });
            const goodAccount = makeAccount({ id: 'good-acct' });
            const tenant = makeTenant({ tenantId: 'tenant-1', accountId: goodAccount.id });
            const sub = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Sub', tenantId: tenant.tenantId, accountId: goodAccount.id });
            const { tree } = createMockPagedDataItemTree(
                [badAccount, goodAccount],
                pagedChildren([
                    [goodAccount, [[tenant]]],
                    [tenant, [[sub]]],
                ]),
                { failNodes: new Set<ConcreteAzureNode>([badAccount]) },
            );

            const { subscriptions, failures } = await listReachableSubscriptions(tree);

            expect(subscriptions.map(s => s.subscription.subscriptionId)).to.deep.equal(['sub-1']);
            expect(failures).to.have.lengthOf(1);
            expect(failures[0].account).to.equal(badAccount);
            // The account's own tenant list failed, so there is no owning tenant.
            expect(failures[0].tenant).to.be.undefined;
        });
    });
});
