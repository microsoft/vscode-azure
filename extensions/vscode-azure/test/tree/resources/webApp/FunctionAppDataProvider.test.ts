/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppServiceLogicalType, AzureListingCache, AzureNodeId, IWebAppClientProvider, LogicAppLogicalType, type ConcreteAzureNode, type FunctionEnvelope, type Site } from '@microsoft/vscode-azure-azutils';
import { createMockAzureListingFetcher, createMockWebAppClient, makeFunctionEnvelope, type MockWebAppClientOptions } from '@microsoft/vscode-azure-azutils/testing';
import { collectPages, DataItemTree, IActionExecutor, IVsCode, type DataProvider, type Page } from '@microsoft/vscode-azure-utils';
import { createTestActionExecutor, pagesOf, rejectingAsyncIterable } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { Container } from 'inversify';
import { RefreshResourcesView } from '../../../../src/commands/tree/RefreshResourcesView';
import type { ManagedCommand } from '../../../../src/commands/ManagedCommand';
import { WebAppSettingsAdapter } from '../../../../src/settings/adapters/WebAppSettingsAdapter';
import { isSettingsNode } from '../../../../src/tree/resources/settings/SettingsNode';
import { FunctionAppVirtualTypes, isFunctionAppFunction, type FunctionApp, type FunctionAppInvalidNode } from '../../../../src/tree/resources/webApp/FunctionApp';
import { FunctionAppDataProvider } from '../../../../src/tree/resources/webApp/FunctionAppDataProvider';
import { registerFunctions } from '../../../../src/products/registerFunctions';
import { ProductRegistrar } from '../../../../src/registration/ProductRegistrar';
import { bindProviders } from '../../../../src/services';
import { getWebsiteUrl } from '../../../../src/tree/resources/websiteUrl';
import { makeSettingsResource } from '../../../settings/mockSettings';
import { makeFunctionAppFunctions } from './mockFunctionApp';

describe('FunctionAppDataProvider (unit)', () => {
    afterEach(() => { mock.restoreAll(); });

    function setup(options?: MockWebAppClientOptions) {
        const client = createMockWebAppClient(options);
        const { executor, code, output } = createTestActionExecutor();
        const adapter = new WebAppSettingsAdapter(code, () => client);
        const provider = new FunctionAppDataProvider(executor, () => client, adapter, code);
        return { client, executor, code, output, adapter, provider };
    }

    it('claims Function Apps and their remote functions without claiming shared settings nodes', async () => {
        const { provider } = setup();
        const app = makeSettingsResource();
        expect(provider.canHandle(app)).to.be.true;
        expect(provider.canHandle(makeFunctionAppFunctions(app))).to.be.true;
        expect(provider.canHandle(makeSettingsResource({ logicalType: 'Microsoft.Storage/storageAccounts' }))).to.be.false;
        expect(provider.canHandle(makeSettingsResource({ logicalType: AppServiceLogicalType }))).to.be.false;
        expect(provider.canHandle(makeSettingsResource({ logicalType: LogicAppLogicalType }))).to.be.false;
        const [page] = await collectPages(await provider.getChildren(app));
        expect(provider.canHandle(page.items[0])).to.be.false;
    });

    it('does not read the site again when expanding an enriched app', async () => {
        const { provider, client } = setup();
        const app = makeSettingsResource();
        await provider.enrich(app);
        await provider.getChildren(app);
        await provider.getChildren(app);
        expect(client.webApps.get.mock.callCount()).to.equal(1);
    });

    it('retries the site read on expansion after a failed enrichment', async () => {
        const { provider, client } = setup();
        const app: FunctionApp = makeSettingsResource();
        client.webApps.get.mock.mockImplementationOnce(() => Promise.reject(new Error('offline')));
        await provider.enrich(app);
        expect(app.siteError).to.not.equal(undefined);
        await provider.getChildren(app);
        expect(client.webApps.get.mock.callCount()).to.equal(2);
        expect(app.siteError).to.equal(undefined);
    });

    it('contributes Application Settings before Functions with the owning adapter and resource', async () => {
        const { provider, adapter, client } = setup();
        const app = makeSettingsResource();
        const pages = await collectPages(await provider.getChildren(app));
        const [settings, group] = pages[0]?.items ?? [];
        expect(isSettingsNode(settings)).to.be.true;
        if (!isSettingsNode(settings)) {
            throw new Error('Expected a settings node');
        }
        expect(settings.azureResource).to.equal(app);
        expect(settings.adapter).to.equal(adapter);
        expect(group).to.deep.equal(makeFunctionAppFunctions(app));
        expect(client.webApps.listFunctions.mock.callCount()).to.equal(0);
    });

    it('enriches the same resource with site metadata and its website capability', async () => {
        const { provider, client } = setup({ defaultHostName: 'myfuncapp.azurewebsites.net', site: { state: 'Stopped', functionAppConfig: {} } });
        const app: FunctionApp = makeSettingsResource();
        const key = AzureNodeId.from(app).toString();
        await provider.enrich(app);
        expect(app.site).to.include({ state: 'Stopped' });
        expect(app.site?.functionAppConfig).to.deep.equal({});
        expect(getWebsiteUrl(app)).to.equal('https://myfuncapp.azurewebsites.net');
        expect(AzureNodeId.from(app).toString()).to.equal(key);
        expect(client.webApps.get.mock.calls[0].arguments).to.deep.equal(['MyRG', 'MyFuncApp']);
    });

    it('normalizes qualified names, triggers, authentication and disabled state without exposing settings', async () => {
        const { provider, client } = setup({
            functions: [
                makeFunctionEnvelope({ name: 'MyFuncApp/Http', config: { bindings: [{ type: 'HTTPTrigger', authLevel: 'Anonymous' }] } }),
                makeFunctionEnvelope({ name: 'Timer', config: { bindings: [{ type: 'timerTrigger' }, { type: 'blob', direction: 'out' }], disabled: true }, isDisabled: undefined }),
                makeFunctionEnvelope({ name: 'Queue', isDisabled: true, config: { bindings: [{ type: 'queueTrigger', authLevel: 'admin' }] } }),
                makeFunctionEnvelope({ name: 'Enabled', isDisabled: false, config: { disabled: true, bindings: [{ type: 'httpTrigger' }] } }),
            ],
        });
        const app = makeSettingsResource();
        const [page] = await collectPages(await provider.getChildren(makeFunctionAppFunctions(app)));
        const nodes = page.items;
        expect(nodes.every(isFunctionAppFunction)).to.be.true;
        const functions = nodes.filter(isFunctionAppFunction);
        expect(functions.map(fn => [fn.functionName, fn.triggerKind, fn.isDisabled, fn.authLevel])).to.deep.equal([
            ['Http', 'HTTPTrigger', false, 'anonymous'],
            ['Timer', 'timerTrigger', true, undefined],
            ['Queue', 'queueTrigger', true, undefined],
            ['Enabled', 'httpTrigger', false, undefined],
        ]);
        expect(functions.every(fn => fn.azureResource === app)).to.be.true;
        expect(client.webApps.listFunctions.mock.calls[0].arguments).to.deep.equal(['MyRG', 'MyFuncApp']);
        expect(client.webApps.listApplicationSettings.mock.callCount()).to.equal(0);
        expect(await provider.getChildren(functions[0])).to.deep.equal([]);
    });

    it('keeps malformed entries visible alongside valid functions and gives them distinct keys across pages', async () => {
        const { provider, client, output } = setup();
        const log = mock.method(output, 'error');
        mock.method(client.webApps, 'listFunctions', () => pagesOf(
            [makeFunctionEnvelope({ name: '' }), makeFunctionEnvelope({ name: 'MyFuncApp/Valid' })],
            [makeFunctionEnvelope({ name: 'MyFuncApp/MissingBindings', config: {} }), makeFunctionEnvelope({ name: '' })],
            [
                makeFunctionEnvelope({ name: 'MyFuncApp/NoTrigger', config: { bindings: [{ type: 'http', direction: 'out' }] } }),
                makeFunctionEnvelope({ name: 'MyFuncApp/MalformedBindings', config: { bindings: 'not-an-array' } }),
                makeFunctionEnvelope({ name: 'MyFuncApp/MissingConfig', config: undefined }),
            ],
        ));
        const app = makeSettingsResource();
        const pages = await collectPages(await provider.getChildren(makeFunctionAppFunctions(app)));
        expect(pages.map(page => page.hasMore)).to.deep.equal([true, true, false]);
        const nodes = pages.flatMap(page => page.items);
        expect(nodes.filter(isFunctionAppFunction).map(fn => fn.functionName)).to.deep.equal(['Valid']);
        const invalid = nodes.filter((node): node is FunctionAppInvalidNode => 'virtualType' in node && node.virtualType === FunctionAppVirtualTypes.Invalid);
        expect(invalid).to.have.lengthOf(6);
        expect(new Set(invalid.map(node => AzureNodeId.from(node).toString())).size).to.equal(6);
        expect(invalid.every(node => !!node.error)).to.be.true;
        expect(invalid[1]?.sourceLabel).to.equal('MissingBindings');
        expect(log.mock.callCount()).to.equal(6);
    });

    it('represents a listing failure as an error child rather than a successful empty list', async () => {
        const { provider, client } = setup();
        mock.method(client.webApps, 'listFunctions', () => rejectingAsyncIterable<Page<FunctionEnvelope>>(new Error('Host unavailable')));
        const [page] = await collectPages(await provider.getChildren(makeFunctionAppFunctions()));
        expect(page.hasMore).to.be.false;
        expect(page.items[0]).to.include({ virtualType: FunctionAppVirtualTypes.Invalid, kind: 'functions', error: 'Host unavailable' });
    });

    it('keeps loaded pages visible when the next management-plane page fails', async () => {
        const { provider, client } = setup();
        mock.method(client.webApps, 'listFunctions', async function* () {
            for await (const page of pagesOf([makeFunctionEnvelope()], [])) {
                yield page;
                throw new Error('Next page unavailable');
            }
        });
        const pages = await collectPages(await provider.getChildren(makeFunctionAppFunctions()));
        expect(isFunctionAppFunction(pages[0]?.items[0])).to.be.true;
        expect(pages[1]?.items[0]).to.include({ kind: 'functions', error: 'Next page unavailable' });
        expect(pages[1]?.hasMore).to.be.false;
    });

    it('represents an empty successful listing without an error child', async () => {
        const { provider } = setup();
        const pages = await collectPages(await provider.getChildren(makeFunctionAppFunctions()));
        expect(pages).to.deep.equal([{ items: [], hasMore: false }]);
    });

    it('refreshes an invalid app through the shared tree and recovers its children in place', async () => {
        const { client, executor, code, adapter } = setup();
        const app: FunctionApp = makeSettingsResource();
        const get = mock.method(client.webApps, 'get', (): Promise<Site> => Promise.reject(new Error('Access denied')));
        const tree = new DataItemTree<ConcreteAzureNode>(code, 'functions-test', executor, node => AzureNodeId.from(node).toString(), 60_000);
        tree.registerProvider({ isRoot: true, canHandle: (_node: unknown): _node is ConcreteAzureNode => false, getChildren: () => [app] });
        const registrar = new ProductRegistrar();
        registerFunctions(registrar);
        const container = new Container();
        container.bind(IActionExecutor).toConstantValue(executor);
        container.bind(IVsCode).toConstantValue(code);
        container.bind(IWebAppClientProvider).toConstantValue(() => client);
        container.bind(WebAppSettingsAdapter).toConstantValue(adapter);
        const providers = Symbol('resourceDataProviders');
        bindProviders(container, providers, registrar.getResourceDataProviders());
        for (const provider of container.getAll<DataProvider<ConcreteAzureNode>>(providers)) {
            tree.registerProvider(provider);
        }
        const changed = mock.fn();
        tree.onDidChange(changed);
        try {
            await tree.getChildren();
            await tree.whenEnriched(app);
            expect(app.siteError).to.equal('Access denied');
            expect(changed.mock.callCount()).to.be.greaterThan(0);
            const [invalid] = await tree.getChildren(app);
            expect(invalid).to.include({ kind: 'app', error: 'Access denied' });
            expect(getWebsiteUrl(app)).to.be.undefined;

            get.mock.mockImplementation(() => Promise.resolve({ location: 'eastus', state: 'Running', defaultHostName: 'myfuncapp.azurewebsites.net' }));
            const listings = new AzureListingCache(createMockAzureListingFetcher(), executor);
            const refresh: ManagedCommand<void> = new RefreshResourcesView(tree, listings);
            await refresh.execute(AzureNodeId.from(invalid).toString());
            await tree.getChildren();
            await tree.whenEnriched(app);
            const children = await tree.getChildren(app);
            expect(isSettingsNode(children[0])).to.be.true;
            expect(children[1]).to.deep.equal(makeFunctionAppFunctions(app));
            expect(app.siteError).to.be.undefined;
            expect(app.site?.state).to.equal('Running');
            expect(getWebsiteUrl(app)).to.equal('https://myfuncapp.azurewebsites.net');
            expect(tree.get(AzureNodeId.from(app).toString())).to.equal(app);
        } finally {
            tree.dispose();
        }
    });
});
