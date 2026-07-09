/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, withSettings } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { SignedInTenantsConfigurationKey } from '../../constants';
import { addSignedInTenant, readSignedInTenants, type SignedInTenant } from '../../utils/signedInTenants';

describe('signedInTenants (unit)', () => {
    const settingKey = `vscode-azure.${SignedInTenantsConfigurationKey}`;
    const tenantId = 'aaaaaaaa-1111-2222-3333-444455556666';
    const otherTenantId = 'bbbbbbbb-1111-2222-3333-444455556666';

    function read(settings: Map<string, unknown>): SignedInTenant[] {
        return (settings.get(settingKey) as SignedInTenant[] | undefined) ?? [];
    }

    describe('readSignedInTenants', () => {
        it('should return well-formed entries', async () => {
            const { ctx, mock } = createMockCodeContext();

            await withSettings(mock, { [settingKey]: [{ accountId: 'acct-1', tenantId }] }, () => {
                expect(readSignedInTenants(ctx.code)).to.deep.equal([{ accountId: 'acct-1', tenantId }]);
            });
        });

        it('should drop entries whose tenant id is not a canonical GUID', async () => {
            const { ctx, mock } = createMockCodeContext();

            await withSettings(mock, { [settingKey]: [
                { accountId: 'acct-1', tenantId: 'not-a-guid' },
                { accountId: 'acct-1', tenantId: '' },
                { accountId: 'acct-1', tenantId: `  ${tenantId}  ` },
                { accountId: 'acct-1', tenantId },
            ] }, () => {
                expect(readSignedInTenants(ctx.code)).to.deep.equal([{ accountId: 'acct-1', tenantId }]);
            });
        });

        it('should drop entries missing an account id or that are not objects', async () => {
            const { ctx, mock } = createMockCodeContext();

            await withSettings(mock, { [settingKey]: [
                { tenantId },
                { accountId: '', tenantId },
                'not-an-object',
                null,
                { accountId: 'acct-1', tenantId: otherTenantId },
            ] }, () => {
                expect(readSignedInTenants(ctx.code)).to.deep.equal([{ accountId: 'acct-1', tenantId: otherTenantId }]);
            });
        });

        it('should return an empty array when the setting is not an array', async () => {
            const { ctx, mock } = createMockCodeContext();

            await withSettings(mock, { [settingKey]: 'garbage' }, () => {
                expect(readSignedInTenants(ctx.code)).to.deep.equal([]);
            });
        });
    });

    describe('addSignedInTenant', () => {
        it('should persist a new tenant with the tenant id lowercased', async () => {
            const { ctx, mock } = createMockCodeContext();

            await addSignedInTenant(ctx.code, { accountId: 'acct-1', tenantId: tenantId.toUpperCase() });

            expect(read(mock.settings)).to.deep.equal([{ accountId: 'acct-1', tenantId }]);
        });

        it('should be additive across accounts and tenants', async () => {
            const { ctx, mock } = createMockCodeContext();

            await addSignedInTenant(ctx.code, { accountId: 'acct-1', tenantId });
            await addSignedInTenant(ctx.code, { accountId: 'acct-2', tenantId: otherTenantId });

            expect(read(mock.settings)).to.deep.equal([
                { accountId: 'acct-1', tenantId },
                { accountId: 'acct-2', tenantId: otherTenantId },
            ]);
        });

        it('should not duplicate an entry already present (case-insensitive)', async () => {
            const { ctx, mock } = createMockCodeContext();

            await withSettings(mock, { [settingKey]: [{ accountId: 'acct-1', tenantId }] }, async () => {
                await addSignedInTenant(ctx.code, { accountId: 'acct-1', tenantId: tenantId.toUpperCase() });

                expect(read(mock.settings)).to.deep.equal([{ accountId: 'acct-1', tenantId }]);
            });
        });

        it('should not duplicate an entry whose account id differs only in casing', async () => {
            const { ctx, mock } = createMockCodeContext();

            await withSettings(mock, { [settingKey]: [{ accountId: 'Acct-1', tenantId }] }, async () => {
                await addSignedInTenant(ctx.code, { accountId: 'ACCT-1', tenantId });

                // Account ids are compared case-insensitively, and the originally
                // persisted casing is left untouched.
                expect(read(mock.settings)).to.deep.equal([{ accountId: 'Acct-1', tenantId }]);
            });
        });

        it('should persist the account id verbatim (only the tenant id is lowercased)', async () => {
            const { ctx, mock } = createMockCodeContext();

            await addSignedInTenant(ctx.code, { accountId: 'Acct-MixedCase', tenantId: tenantId.toUpperCase() });

            expect(read(mock.settings)).to.deep.equal([{ accountId: 'Acct-MixedCase', tenantId }]);
        });
    });
});
