/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeAccount, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import type { ReachableTenant } from '../../commands/listReachableAuthNodes';
import { pickTenantOrEnterId } from '../../commands/pickTenant';

describe('pickTenantOrEnterId (unit)', () => {
    function makeReachableTenant(tenantId: string, displayName: string): ReachableTenant {
        const account = makeAccount({ id: 'acct-1', label: 'Account One' });
        return { account, tenant: makeTenant({ tenantId, displayName, accountId: account.id }) };
    }

    it('should offer a synthetic sign-in item for a pasted tenant GUID', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tenantId = 'aaaaaaaa-1111-2222-3333-444455556666';

        const resultPromise = pickTenantOrEnterId(ctx, [makeReachableTenant('tenant-1', 'Tenant One')]);

        const qp = mock.quickPicks[0];
        qp.changeValue(tenantId);

        // The synthetic "sign in to <id>" item is listed after the suggestion.
        const synthetic = qp.items[qp.items.length - 1];
        expect(synthetic.label).to.equal(`Sign in to tenant: ${tenantId}`);

        qp.accept();
        const pick = await resultPromise;
        expect(pick.tenantId).to.equal(tenantId);
        // A typed tenant ID has no known account context.
        expect(pick.accountId).to.be.undefined;
    });

    it('should not offer a synthetic item when the typed value is not a GUID', async () => {
        const { ctx, mock } = createMockCodeContext();

        const resultPromise = pickTenantOrEnterId(ctx, [makeReachableTenant('tenant-1', 'Tenant One')]);

        const qp = mock.quickPicks[0];
        // Users never type a tenant GUID -- a non-GUID value is a filter, so no
        // synthetic sign-in item should be offered.
        qp.changeValue('Tenant');

        expect(qp.items.some(item => item.label.startsWith('Sign in to tenant:'))).to.be.false;
        expect(qp.items).to.have.length(1);

        // Activate and accept the remaining suggestion so the prompt resolves
        // (the mock does not auto-activate filtered items the way VS Code does).
        qp.activeItems = [qp.items[0]];
        qp.accept();
        const pick = await resultPromise;
        expect(pick.tenantId).to.equal('tenant-1');
        expect(pick.accountId).to.equal('acct-1');
    });
});
