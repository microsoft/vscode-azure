/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { collectAsync, type Page } from '@microsoft/vscode-azure-utils';
import * as assert from 'node:assert';
import type { AzureTenant } from '../../../src/auth/AzureSubscription';
import { additionalTenantsFor, withAdditionalTenants } from '../../../src/auth/listing/additionalTenants';
import { makeAccount, makeTenant } from '../../mockAzure';

const account = makeAccount({ id: 'acct', label: 'Account' });

// eslint-disable-next-line @typescript-eslint/require-await
async function* pagesOf(...pages: Page<AzureTenant>[]): AsyncIterable<Page<AzureTenant>> {
    yield* pages;
}

/** Flatten a tenant listing to `tenantId:displayName` pairs, page by page. */
async function collectTenants(pages: AsyncIterable<Page<AzureTenant>>): Promise<string[][]> {
    return (await collectAsync(pages)).map(page => page.items.map(tenant => `${tenant.tenantId}:${tenant.displayName}`));
}

describe('additionalTenants (unit)', () => {
    describe('additionalTenantsFor', () => {
        it('stands the id in for the display name enumeration could not supply', () => {
            const [tenant] = additionalTenantsFor(account, ['Tenant-1']);

            assert.strictEqual(tenant.displayName, 'Tenant-1');
            assert.strictEqual(tenant.tenantId, 'tenant-1');
        });

        it('attributes the tenant to the account that named it', () => {
            const [tenant] = additionalTenantsFor(account, ['tenant-1']);

            assert.strictEqual(tenant.accountId, account.id);
            assert.deepStrictEqual(tenant.environment, account.environment);
        });

        it('deduplicates ids that differ only by case', () => {
            const tenants = additionalTenantsFor(account, ['Tenant-1', 'tenant-1', 'TENANT-1', 'tenant-2']);

            assert.deepStrictEqual(tenants.map(tenant => tenant.tenantId), ['tenant-1', 'tenant-2']);
        });
    });

    describe('withAdditionalTenants', () => {
        const named = additionalTenantsFor(account, ['tenant-named']);

        it('joins the extras to the terminal page', async () => {
            const listed = makeTenant({ accountId: account.id, tenantId: 'tenant-listed', displayName: 'Listed' });

            const pages = await collectTenants(withAdditionalTenants(pagesOf({ items: [listed], hasMore: false }), named));

            assert.deepStrictEqual(pages, [['tenant-listed:Listed', 'tenant-named:tenant-named']]);
        });

        it('leaves earlier pages exactly as the listing produced them', async () => {
            const first = makeTenant({ accountId: account.id, tenantId: 'tenant-1', displayName: 'One' });
            const second = makeTenant({ accountId: account.id, tenantId: 'tenant-2', displayName: 'Two' });

            const pages = await collectTenants(
                withAdditionalTenants(pagesOf({ items: [first], hasMore: true }, { items: [second], hasMore: false }), named),
            );

            assert.deepStrictEqual(pages, [['tenant-1:One'], ['tenant-2:Two', 'tenant-named:tenant-named']]);
        });

        it('emits a terminal page so named tenants survive a listing that produced nothing', async () => {
            const pages = await collectTenants(withAdditionalTenants(pagesOf(), named));

            assert.deepStrictEqual(pages, [['tenant-named:tenant-named']]);
        });

        it('keeps the display name the listing gave a tenant that was also named', async () => {
            const listed = makeTenant({ accountId: account.id, tenantId: 'TENANT-NAMED', displayName: 'Real Name' });

            const pages = await collectTenants(withAdditionalTenants(pagesOf({ items: [listed], hasMore: false }), named));

            assert.deepStrictEqual(pages, [['TENANT-NAMED:Real Name']]);
        });

        it('drops an extra the listing already produced on an earlier page', async () => {
            const listed = makeTenant({ accountId: account.id, tenantId: 'tenant-named', displayName: 'Real Name' });
            const other = makeTenant({ accountId: account.id, tenantId: 'tenant-other', displayName: 'Other' });

            const pages = await collectTenants(
                withAdditionalTenants(pagesOf({ items: [listed], hasMore: true }, { items: [other], hasMore: false }), named),
            );

            assert.deepStrictEqual(pages, [['tenant-named:Real Name'], ['tenant-other:Other']]);
        });
    });
});
