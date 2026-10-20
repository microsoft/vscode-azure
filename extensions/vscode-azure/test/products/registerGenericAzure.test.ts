/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureListingCache,
    AzureListingFetcher,
    AzureUSGovernment,
    IAzureListingCache,
    IAzureListingFetcher,
    ICredentialFactory,
    IDeploymentClientProvider,
    IResourceClientProvider,
    ISubscriptionClientProvider,
    ResourceClient,
    SubscriptionClient,
} from '@microsoft/vscode-azure-azutils';
import { createMockAzureListingFetcher, makeAccount, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { collectPageItems, IActionExecutor, ICodeContext, IExtensionContext, IOutputChannel, IVsCode } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, createTestActionExecutor, MockCancellationToken, withSettings } from '@microsoft/vscode-azure-utils/testing';
import { Container } from 'inversify';
import { mock } from 'node:test';
import { ConfigurationSection, SignedInTenantsConfigurationKey } from '../../src/constants';
import { registerGenericAzure } from '../../src/products/registerGenericAzure';
import { IPropertiesContentProvider, PropertiesScheme } from '../../src/properties/PropertiesContentProvider';
import { ProductRegistrar } from '../../src/registration/ProductRegistrar';
import { ISubscriptionResolver } from '../../src/services';
import { ICredentialOptionsScope } from '../../src/utils/CredentialOptionsScope';

function createContainer() {
    const { ctx, mock: mockResult } = createMockCodeContext();
    const { executor, output } = createTestActionExecutor();
    const container = new Container();
    container.bind(IVsCode).toConstantValue(ctx.code);
    container.bind(ICodeContext).toConstantValue(ctx);
    container.bind(IExtensionContext).toConstantValue(ctx.extensionContext);
    container.bind(IActionExecutor).toConstantValue(executor);
    container.bind(IOutputChannel).toConstantValue(output);
    const registrar = new ProductRegistrar();
    registerGenericAzure(registrar);
    registrar.applyBindings(container);
    return { container, registrar, ctx, mockResult, executor };
}

describe('registerGenericAzure (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('should resolve subscriptions through the shared listing cache', async () => {
        const { container } = createContainer();
        const fetcher = container.get(IAzureListingFetcher);
        const listing = createMockAzureListingFetcher();
        mock.method(fetcher, 'fetchAccounts', listing.fetchAccounts);
        mock.method(fetcher, 'fetchTenants', listing.fetchTenants);
        mock.method(fetcher, 'fetchSubscriptions', listing.fetchSubscriptions);
        const cache = container.get(IAzureListingCache);
        const resolveSubscription = container.get(ISubscriptionResolver);
        const subscription = makeSubscription();

        expect(fetcher).to.be.instanceOf(AzureListingFetcher);
        expect(cache).to.be.instanceOf(AzureListingCache);
        const resolved = await resolveSubscription(subscription.subscriptionId.toUpperCase());
        expect(resolved).to.deep.equal(subscription);
        expect(await resolveSubscription(subscription.subscriptionId)).to.equal(resolved);
        expect(listing.fetchSubscriptions.mock.callCount()).to.equal(1);
        expect(container.get(IAzureListingCache)).to.equal(cache);
        expect(await resolveSubscription('missing-subscription')).to.be.undefined;
    });

    it('should read named tenants on every cached listing', async () => {
        const { container, mockResult } = createContainer();
        const account = makeAccount();
        const tenant = makeTenant();
        const listing = createMockAzureListingFetcher({ accounts: [account], tenants: [tenant] });
        const fetcher = container.get(IAzureListingFetcher);
        mock.method(fetcher, 'fetchTenants', listing.fetchTenants);
        const cache = container.get(IAzureListingCache);
        const setting = `${ConfigurationSection}.${SignedInTenantsConfigurationKey}`;
        const namedTenantId = 'aaaaaaaa-1111-2222-3333-444455556666';

        expect((await collectPageItems(cache.listTenants(account))).map(item => item.tenantId)).to.deep.equal([tenant.tenantId]);
        await withSettings(mockResult, {
            [setting]: [{ accountId: account.id.toUpperCase(), tenantId: namedTenantId }],
        }, async () => {
            const tenants = await collectPageItems(cache.listTenants(account));
            expect(tenants.map(item => item.tenantId)).to.have.members([tenant.tenantId, namedTenantId]);
        });
        expect((await collectPageItems(cache.listTenants(account))).map(item => item.tenantId)).to.deep.equal([tenant.tenantId]);
        expect(listing.fetchTenants.mock.callCount()).to.equal(1);
    });

    it('should apply ambient credential options at factory call time', async () => {
        const { container, mockResult } = createContainer();
        const factory = container.get(ICredentialFactory);
        const scope = container.get(ICredentialOptionsScope);
        const subscription = makeSubscription();

        await scope.run({ sessionOptions: { silent: true } }, async () => {
            await factory(subscription).getToken('https://management.azure.com/.default');
        });
        await factory(subscription).getToken('https://management.azure.com/.default');

        const calls = mockResult.authentication.getSession.mock.calls;
        expect(calls).to.have.length(2);
        expect(calls[0].arguments[1]).to.include(`VSCODE_TENANT:${subscription.tenantId}`);
        expect(calls[0].arguments[2]).to.deep.equal({
            silent: true,
            account: { id: subscription.accountId, label: '' },
        });
        expect(calls[1].arguments[2]).to.deep.equal({
            createIfNone: true,
            account: { id: subscription.accountId, label: '' },
        });
    });

    it('should create subscription-scoped Azure clients with the requested cloud', () => {
        const resourceCreate = mock.method(ResourceClient, 'create');
        const subscriptionCreate = mock.method(SubscriptionClient, 'create');
        const { container, ctx, executor } = createContainer();
        const subscription = makeSubscription({ environment: AzureUSGovernment });

        container.get(IResourceClientProvider)(subscription);
        container.get(IDeploymentClientProvider)(subscription);
        container.get(ISubscriptionClientProvider)(subscription);

        expect(resourceCreate.mock.callCount()).to.equal(1);
        expect(resourceCreate.mock.calls[0].arguments[0]).to.equal(ctx);
        expect(resourceCreate.mock.calls[0].arguments[1]).to.equal(executor);
        expect(resourceCreate.mock.calls[0].arguments[3]).to.equal(subscription);
        expect(subscriptionCreate.mock.callCount()).to.equal(1);
        expect(subscriptionCreate.mock.calls[0].arguments[3]).to.equal(subscription.environment);
        expect(subscriptionCreate.mock.calls[0].arguments[5]).to.equal(subscription);
    });

    it('should register the resolved properties provider and own its registration lifetime', async () => {
        const { container, registrar, ctx, mockResult } = createContainer();
        const provider = container.get(IPropertiesContentProvider);

        registrar.activate(container);

        const registration = mockResult.workspace.registerTextDocumentContentProvider.mock;
        expect(registration.callCount()).to.equal(1);
        expect(registration.calls[0].arguments).to.deep.equal([PropertiesScheme, provider]);
        expect(ctx.extensionContext.subscriptions).to.include(registration.calls[0].result);
        const document = await provider.openTextDocument('{"name":"resource"}');
        const token = new MockCancellationToken();
        try {
            expect(await provider.provideTextDocumentContent(document.uri, token)).to.equal('{"name":"resource"}');
        } finally {
            token.dispose();
        }
    });
});
