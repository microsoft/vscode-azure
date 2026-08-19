/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { collectPageItems, type Page } from '@microsoft/vscode-azure-utils';
import * as assert from 'node:assert';
import type { AzureListingNode } from '../../../src/auth/listing/AzureListingStore';
import { azureListingKey, azureListingKeyFor, AzureListingRootKey, AzureListingStore } from '../../../src/auth/listing/AzureListingStore';
import { makeAccount, makeSubscription, makeTenant } from '../../mockAzure';

/** A one-page listing of the given nodes. */
function onePage<T extends AzureListingNode>(items: T[]): () => AsyncIterable<Page<T>> {
    return async function* () {
        yield await Promise.resolve({ items, hasMore: false });
    };
}

describe('AzureListingStore (unit)', () => {
    it('keys a subscription by its account, tenant, and subscription ids', () => {
        const subscription = makeSubscription({ accountId: 'acct', tenantId: 'tenant', subscriptionId: 'sub' });
        assert.strictEqual(azureListingKey(subscription), 'acct/tenant/sub');
    });

    it('keeps the same subscription under two tenants as two entries', () => {
        const store = new AzureListingStore();
        const viaFirst = makeSubscription({ accountId: 'acct', tenantId: 'tenant-a', subscriptionId: 'shared', displayName: 'Via A' });
        const viaSecond = makeSubscription({ accountId: 'acct', tenantId: 'tenant-b', subscriptionId: 'shared', displayName: 'Via B' });

        store.index(viaFirst);
        store.index(viaSecond);

        assert.strictEqual(store.get('acct/tenant-a/shared'), viaFirst);
        assert.strictEqual(store.get('acct/tenant-b/shared'), viaSecond);
        assert.strictEqual([...store.scan()].length, 2);
    });

    it('encodes segments so one account cannot masquerade as another account descendant', () => {
        const store = new AzureListingStore();
        // A VS Code account id is an opaque provider string and may contain '/'.
        const nested = makeAccount({ id: 'acct/tenant' });
        const outer = makeAccount({ id: 'acct' });
        store.index(nested);
        store.index(outer);

        store.evict(azureListingKey(outer));

        assert.strictEqual(store.get(azureListingKeyFor('acct/tenant')), nested, 'the other account must survive');
    });

    it('matches keys case-insensitively', () => {
        const store = new AzureListingStore();
        const tenant = makeTenant({ accountId: 'Acct', tenantId: 'Tenant-ABC' });
        store.index(tenant);

        assert.strictEqual(store.get('acct/tenant-abc'), tenant);
    });

    it('distinguishes "no children cached" from "cached, and there are none"', async () => {
        const store = new AzureListingStore();
        const key = azureListingKeyFor('acct', 'tenant');

        assert.strictEqual(store.isComplete(key), false);

        await collectPageItems(store.listing(key, onePage<AzureListingNode>([])).read());

        assert.strictEqual(store.isComplete(key), true);
        assert.deepStrictEqual([...store.scan(key)], []);
    });

    it('evicts a subtree by prefix, leaving siblings alone', async () => {
        const store = new AzureListingStore();
        const accountKey = azureListingKeyFor('acct');
        const keptKey = azureListingKeyFor('other');

        store.index(makeAccount({ id: 'acct' }));
        store.index(makeAccount({ id: 'other' }));
        store.index(makeTenant({ accountId: 'acct', tenantId: 'tenant' }));
        store.index(makeSubscription({ accountId: 'acct', tenantId: 'tenant', subscriptionId: 'sub' }));
        store.index(makeTenant({ accountId: 'other', tenantId: 'tenant' }));
        await collectPageItems(store.listing(azureListingKeyFor('acct', 'tenant'), onePage<AzureListingNode>([])).read());

        store.evict(accountKey);

        assert.strictEqual(store.get(accountKey), undefined);
        assert.strictEqual(store.get(azureListingKeyFor('acct', 'tenant')), undefined);
        assert.strictEqual(store.get(azureListingKeyFor('acct', 'tenant', 'sub')), undefined);
        assert.strictEqual(store.isComplete(azureListingKeyFor('acct', 'tenant')), false);
        assert.notStrictEqual(store.get(keptKey), undefined, 'a sibling account must be untouched');
        assert.notStrictEqual(store.get(azureListingKeyFor('other', 'tenant')), undefined);
    });

    it('drops only the listing when asked, keeping the children already fetched', async () => {
        const store = new AzureListingStore();
        const accounts = [makeAccount({ id: 'acct' })];
        await collectPageItems(store.listing(AzureListingRootKey, onePage(accounts)).read());
        store.index(makeTenant({ accountId: 'acct', tenantId: 'tenant' }));

        store.evictListing(AzureListingRootKey);

        assert.strictEqual(store.isComplete(AzureListingRootKey), false, 'the listing itself is gone');
        assert.notStrictEqual(store.get(azureListingKeyFor('acct', 'tenant')), undefined, 'what was cached beneath it is not');
    });

    it('serves a second listing of the same parent from cache', async () => {
        const store = new AzureListingStore();
        let calls = 0;
        const factory = () => {
            calls++;
            return onePage<AzureListingNode>([makeAccount({ id: 'acct' })])();
        };

        await collectPageItems(store.listing(AzureListingRootKey, factory).read());
        await collectPageItems(store.listing(AzureListingRootKey, factory).read());

        assert.strictEqual(calls, 1);
    });
});
