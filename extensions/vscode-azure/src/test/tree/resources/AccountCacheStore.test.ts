/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AccountCacheFormatVersion, AzurePublicCloud, buildAccountCacheData, tenantCacheKey, type CachedAccountData } from '@microsoft/vscode-azure-azutils';
import { makeAccount, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { AccountCacheStore } from '../../../tree/resources/AccountCacheStore';

describe('AccountCacheStore (unit)', () => {
    function createStore() {
        const { ctx, mock } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const store = new AccountCacheStore(ctx, executor);
        return { store, fs: mock.fs, ctx };
    }

    function sampleData(): CachedAccountData {
        const account = makeAccount({ id: 'acct-1', label: 'Account One' });
        const tenant = makeTenant({ tenantId: 't-1', displayName: 'Tenant One', accountId: 'acct-1' });
        const subscription = makeSubscription({ subscriptionId: 's-1', displayName: 'Sub One', tenantId: 't-1', accountId: 'acct-1' });
        return buildAccountCacheData(
            AzurePublicCloud,
            [account],
            new Map([['acct-1', [tenant]]]),
            new Map([[tenantCacheKey('acct-1', 't-1'), [subscription]]]),
        );
    }

    it('should return undefined when no cache file exists', async () => {
        const { store } = createStore();
        expect(await store.load()).to.be.undefined;
    });

    it('should round-trip a saved snapshot', async () => {
        const { store } = createStore();
        const data = sampleData();

        await store.save(data);
        const loaded = await store.load();

        expect(loaded).to.deep.equal(data);
    });

    it('should write the snapshot under globalStorageUri and create the directory', async () => {
        const { store, fs } = createStore();

        await store.save(sampleData());

        expect(fs.createDirectory.mock.callCount()).to.equal(1);
        expect(fs.createDirectory.mock.calls[0].arguments[0].path).to.equal('/mock/globalStorage');
        const writeUri = fs.writeFile.mock.calls[0].arguments[0];
        expect(writeUri.path).to.equal('/mock/globalStorage/accountCache.json');
    });

    it('should return undefined for malformed JSON', async () => {
        const { store, fs, ctx } = createStore();
        fs.addFile(ctx.code.Uri.joinPath(ctx.extensionContext.globalStorageUri, 'accountCache.json'), '{ not valid json');

        expect(await store.load()).to.be.undefined;
    });

    it('should return undefined for an unrecognized format version', async () => {
        const { store, fs, ctx } = createStore();
        const data = { ...sampleData(), version: AccountCacheFormatVersion + 1 };
        fs.addFile(ctx.code.Uri.joinPath(ctx.extensionContext.globalStorageUri, 'accountCache.json'), JSON.stringify(data));

        expect(await store.load()).to.be.undefined;
    });

    it('should return undefined when the parsed value is structurally invalid', async () => {
        const { store, fs, ctx } = createStore();
        fs.addFile(ctx.code.Uri.joinPath(ctx.extensionContext.globalStorageUri, 'accountCache.json'), JSON.stringify({ version: 1, accounts: 'nope' }));

        expect(await store.load()).to.be.undefined;
    });

    it('should clear a persisted snapshot', async () => {
        const { store, fs } = createStore();
        await store.save(sampleData());

        await store.clear();

        expect(fs.delete.mock.callCount()).to.equal(1);
        expect(await store.load()).to.be.undefined;
    });

    it('should not throw when clearing a non-existent file', async () => {
        const { store } = createStore();
        await store.clear();
        expect(await store.load()).to.be.undefined;
    });

    it('should serialize overlapping saves so the last write wins', async () => {
        const { store } = createStore();
        const first = sampleData();
        const second = { ...sampleData(), accounts: [] };

        await Promise.all([store.save(first), store.save(second)]);

        expect(await store.load()).to.deep.equal(second);
    });
});
