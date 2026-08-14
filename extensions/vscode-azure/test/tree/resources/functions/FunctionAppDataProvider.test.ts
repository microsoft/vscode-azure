/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockWebAppClient, makeGenericResource, makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { FunctionAppVirtualPaths, FunctionAppVirtualTypes } from '../../../../src/tree/resources/functions/FunctionApp';
import { FunctionAppDataProvider } from '../../../../src/tree/resources/functions/FunctionAppDataProvider';
import { getWebsiteUrl } from '../../../../src/tree/resources/websiteUrl';
import { makeFunctionApp } from './mockFunctionApp';

describe('FunctionAppDataProvider (unit)', () => {
    function createProvider(settingsOverride?: Record<string, string>) {
        const { executor } = createTestActionExecutor();
        const mockClient = createMockWebAppClient({
            // eslint-disable-next-line @typescript-eslint/naming-convention -- app setting keys use SCREAMING_SNAKE_CASE
            settings: settingsOverride ?? { MY_KEY: 'my-value', OTHER: 'other-value' },
        });
        const createClient = mock.fn(() => mockClient);
        const provider = new FunctionAppDataProvider(executor, createClient);
        return { provider, mockClient, createClient };
    }

    describe('canHandle', () => {
        it('should return true for Function App resources', () => {
            const { provider } = createProvider();
            expect(provider.canHandle(makeFunctionApp())).to.be.true;
        });

        it('should return true for virtual resources owned by a Function App', () => {
            const { provider } = createProvider();
            const vr = makeVirtualResource({
                virtualType: FunctionAppVirtualTypes.AppSettings,
                virtualPath: FunctionAppVirtualPaths.AppSettings,
                azureResource: makeFunctionApp(),
            });
            expect(provider.canHandle(vr)).to.be.true;
        });

        it('should return false for non-Function App generic resources', () => {
            const { provider } = createProvider();
            expect(provider.canHandle(makeGenericResource())).to.be.false;
        });

        it('should return false for non-objects', () => {
            const { provider } = createProvider();
            expect(provider.canHandle(null)).to.be.false;
            expect(provider.canHandle('string')).to.be.false;
            expect(provider.canHandle(42)).to.be.false;
        });
    });

    describe('enrich', () => {
        it('should attach the function app website url', async () => {
            const { executor } = createTestActionExecutor();
            const mockClient = createMockWebAppClient({ defaultHostName: 'myfunc.azurewebsites.net' });
            const provider = new FunctionAppDataProvider(executor, mock.fn(() => mockClient));
            const app = makeFunctionApp();

            await provider.enrich(app);

            expect(getWebsiteUrl(app)).to.equal('https://myfunc.azurewebsites.net/');
        });

        it('should ignore virtual nodes', async () => {
            const { provider, mockClient } = createProvider();
            const category = makeVirtualResource({
                virtualType: FunctionAppVirtualTypes.AppSettings,
                virtualPath: FunctionAppVirtualPaths.AppSettings,
                azureResource: makeFunctionApp(),
            });

            await provider.enrich(category);

            expect(mockClient.webApps.get.mock.callCount()).to.equal(0);
        });
    });

    describe('getChildren', () => {
        it('should return empty array for no resource', async () => {
            const { provider } = createProvider();
            expect(await provider.getChildren()).to.deep.equal([]);
        });

        it('should return App Settings category for a Function App resource', async () => {
            const { provider } = createProvider();
            const children = await provider.getChildren(makeFunctionApp());
            expect(children).to.have.length(1);
            const child = children[0];
            expect('virtualType' in child && child.virtualType).to.equal(FunctionAppVirtualTypes.AppSettings);
            expect('virtualPath' in child && child.virtualPath).to.equal(FunctionAppVirtualPaths.AppSettings);
        });

        it('should return individual setting items for an App Settings category', async () => {
            const { provider } = createProvider({ ALPHA: 'a', BETA: 'b' });
            const category = makeVirtualResource({
                virtualType: FunctionAppVirtualTypes.AppSettings,
                virtualPath: FunctionAppVirtualPaths.AppSettings,
                azureResource: makeFunctionApp(),
            });
            const children = await provider.getChildren(category);
            expect(children).to.have.length(2);
            // Should be sorted alphabetically
            const paths = children.map(c => 'virtualPath' in c ? c.virtualPath : '');
            expect(paths).to.deep.equal(['ALPHA', 'BETA']);
        });

        it('should return empty for an unknown virtual resource type', async () => {
            const { provider } = createProvider();
            const vr = makeVirtualResource({
                virtualType: 'functionApp.unknown',
                virtualPath: 'Unknown',
                azureResource: makeFunctionApp(),
            });
            expect(await provider.getChildren(vr)).to.deep.equal([]);
        });
    });

    describe('settings cache', () => {
        it('should cache setting values after listing children', async () => {
            // eslint-disable-next-line @typescript-eslint/naming-convention -- app setting keys use SCREAMING_SNAKE_CASE
            const { provider } = createProvider({ MY_KEY: 'cached-value' });
            const app = makeFunctionApp();
            const category = makeVirtualResource({
                virtualType: FunctionAppVirtualTypes.AppSettings,
                virtualPath: FunctionAppVirtualPaths.AppSettings,
                azureResource: app,
            });
            await provider.getChildren(category);
            expect(provider.getSettingValue(app.id, 'MY_KEY')).to.equal('cached-value');
        });

        it('should return undefined for uncached settings', () => {
            const { provider } = createProvider();
            expect(provider.getSettingValue('nonexistent', 'KEY')).to.be.undefined;
        });
    });

    describe('addOrUpdateSetting', () => {
        it('should add a new setting and update the cache', async () => {
            const { provider, mockClient } = createProvider({ EXISTING: 'val' });
            const app = makeFunctionApp();

            await provider.addOrUpdateSetting(app, 'NEW_KEY', 'new-value');

            const updateCall = mockClient.webApps.updateApplicationSettings.mock.calls[0];
            const body = updateCall.arguments[2];
            expect(body.properties).to.have.property('NEW_KEY', 'new-value');
            expect(body.properties).to.have.property('EXISTING', 'val');

            // Cache should be updated
            expect(provider.getSettingValue(app.id, 'NEW_KEY')).to.equal('new-value');
        });

        it('should create a lightweight client for each operation', async () => {
            const { provider, createClient } = createProvider();
            const app = makeFunctionApp();

            await provider.addOrUpdateSetting(app, 'FIRST', 'one');
            await provider.addOrUpdateSetting(app, 'SECOND', 'two');

            expect(createClient.mock.callCount()).to.equal(2);
        });
    });

    describe('deleteSetting', () => {
        it('should remove a setting and update the cache', async () => {
            const { provider, mockClient } = createProvider({ KEEP: 'yes', REMOVE: 'no' });
            const app = makeFunctionApp();

            await provider.deleteSetting(app, 'REMOVE');

            const updateCall = mockClient.webApps.updateApplicationSettings.mock.calls[0];
            const body = updateCall.arguments[2];
            expect(body.properties).to.have.property('KEEP', 'yes');
            expect(body.properties).to.not.have.property('REMOVE');

            // Cache should reflect removal
            expect(provider.getSettingValue(app.id, 'REMOVE')).to.be.undefined;
            expect(provider.getSettingValue(app.id, 'KEEP')).to.equal('yes');
        });
    });
});
