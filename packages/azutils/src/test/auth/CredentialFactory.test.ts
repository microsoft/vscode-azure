/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { createDefaultCredentialFactory } from '../../auth/CredentialFactory';
import { makeSubscription } from '../mockAzure';

describe('createDefaultCredentialFactory (unit)', () => {
    it('should produce a TokenCredential', () => {
        const { vscode } = createMockVsCode();
        const factory = createDefaultCredentialFactory(vscode);

        const credential = factory();
        expect(credential.getToken).to.be.a('function');
    });

    it('should scope the credential to a subscription tenant and account', async () => {
        const { vscode } = createMockVsCode();
        const subscription = makeSubscription();
        const factory = createDefaultCredentialFactory(vscode);

        const credential = factory(subscription);
        await credential.getToken(['scope']);

        const getSession = (vscode.authentication.getSession as unknown as { mock: { calls: { arguments: unknown[] }[] } }).mock;
        expect(getSession.calls).to.have.length(1);
        const [, scopes, options] = getSession.calls[0].arguments as [string, string[], { account?: { id: string } }];
        expect(scopes).to.include(`VSCODE_TENANT:${subscription.tenantId}`);
        expect(options.account?.id).to.equal(subscription.accountId);
    });

    it('should scope the credential using explicit options', async () => {
        const { vscode } = createMockVsCode();
        const factory = createDefaultCredentialFactory(vscode);

        const credential = factory({ tenantId: 'explicit-tenant' });
        await credential.getToken(['scope']);

        const getSession = (vscode.authentication.getSession as unknown as { mock: { calls: { arguments: unknown[] }[] } }).mock;
        const [, scopes] = getSession.calls[0].arguments as [string, string[]];
        expect(scopes).to.include('VSCODE_TENANT:explicit-tenant');
    });

    it('should produce an unscoped credential when no input is given', async () => {
        const { vscode } = createMockVsCode();
        const factory = createDefaultCredentialFactory(vscode);

        const credential = factory();
        await credential.getToken(['scope']);

        const getSession = (vscode.authentication.getSession as unknown as { mock: { calls: { arguments: unknown[] }[] } }).mock;
        const [, scopes] = getSession.calls[0].arguments as [string, string[]];
        expect(scopes.some(s => s.startsWith('VSCODE_TENANT:'))).to.be.false;
    });
});
