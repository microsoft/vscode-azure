/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import {
    AzureChinaCloud, AzurePublicCloud, AzureUSGovernment,
    getAuthProviderId, getConfiguredAzureEnv,
    PublicAuthProviderId, SovereignAuthProviderId,
} from '../../src/auth/Environment';

describe('Environment (unit)', () => {
    describe('presets', () => {
        it('should build storage, container registry, and app service endpoints for public cloud', () => {
            expect(AzurePublicCloud.storageEndpoint('acct')).to.equal('https://acct.blob.core.windows.net');
            expect(AzurePublicCloud.containerRegistryEndpoint('reg')).to.equal('https://reg.azurecr.io');
            expect(AzurePublicCloud.azureWebSitesEndpoint('site')).to.equal('https://site.azurewebsites.net');
            expect(AzurePublicCloud.isCustomCloud).to.be.false;
        });

        it('should store ARM and portal endpoints without a trailing slash', () => {
            for (const env of [AzurePublicCloud, AzureUSGovernment, AzureChinaCloud]) {
                expect(env.resourceManagerEndpointUrl.endsWith('/'), env.name).to.be.false;
                expect(env.portalUrl.endsWith('/'), env.name).to.be.false;
            }
            expect(AzurePublicCloud.resourceManagerEndpointUrl).to.equal('https://management.azure.com');
        });

        it('should expose a single-slash default ARM scope for each preset', () => {
            for (const env of [AzurePublicCloud, AzureUSGovernment, AzureChinaCloud]) {
                expect(env.resourceManagerDefaultScope, env.name).to.equal(`${env.resourceManagerEndpointUrl}/.default`);
                expect(env.resourceManagerDefaultScope.includes('//.default'), env.name).to.be.false;
            }
            expect(AzurePublicCloud.resourceManagerDefaultScope).to.equal('https://management.azure.com/.default');
        });

        it('should use US Government DNS suffixes', () => {
            expect(AzureUSGovernment.storageEndpoint('acct')).to.equal('https://acct.blob.core.usgovcloudapi.net');
            expect(AzureUSGovernment.containerRegistryEndpoint('reg')).to.equal('https://reg.azurecr.us');
            expect(AzureUSGovernment.azureWebSitesEndpoint('site')).to.equal('https://site.azurewebsites.us');
        });

        it('should use China cloud DNS suffixes', () => {
            expect(AzureChinaCloud.storageEndpoint('acct')).to.equal('https://acct.blob.core.chinacloudapi.cn');
            expect(AzureChinaCloud.containerRegistryEndpoint('reg')).to.equal('https://reg.azurecr.cn');
            expect(AzureChinaCloud.azureWebSitesEndpoint('site')).to.equal('https://site.chinacloudsites.cn');
        });
    });

    describe('getAuthProviderId', () => {
        it('should return the public provider for the public cloud', () => {
            expect(getAuthProviderId(AzurePublicCloud)).to.equal(PublicAuthProviderId);
        });

        it('should return the sovereign provider for sovereign clouds', () => {
            expect(getAuthProviderId(AzureChinaCloud)).to.equal(SovereignAuthProviderId);
            expect(getAuthProviderId(AzureUSGovernment)).to.equal(SovereignAuthProviderId);
        });
    });

    describe('getConfiguredAzureEnv', () => {
        it('should default to the public cloud when nothing is configured', () => {
            const { vscode } = createMockVsCode();
            expect(getConfiguredAzureEnv(vscode)).to.equal(AzurePublicCloud);
        });

        it('should map ChinaCloud to the China preset', () => {
            const mock = createMockVsCode();
            mock.settings.set('microsoft-sovereign-cloud.environment', 'ChinaCloud');
            expect(getConfiguredAzureEnv(mock.vscode)).to.equal(AzureChinaCloud);
        });

        it('should map USGovernment to the US Government preset', () => {
            const mock = createMockVsCode();
            mock.settings.set('microsoft-sovereign-cloud.environment', 'USGovernment');
            expect(getConfiguredAzureEnv(mock.vscode)).to.equal(AzureUSGovernment);
        });

        it('should build a custom cloud from the customEnvironment setting, stripping trailing slashes', () => {
            const mock = createMockVsCode();
            mock.settings.set('microsoft-sovereign-cloud.environment', 'custom');
            mock.settings.set('microsoft-sovereign-cloud.customEnvironment', {
                name: 'MyCloud',
                resourceManagerEndpointUrl: 'https://management.mycloud.example/',
                storageEndpointSuffix: 'core.mycloud.example',
            });

            const env = getConfiguredAzureEnv(mock.vscode);
            expect(env.isCustomCloud).to.be.true;
            expect(env.name).to.equal('MyCloud');
            expect(env.resourceManagerEndpointUrl).to.equal('https://management.mycloud.example');
            expect(env.resourceManagerDefaultScope).to.equal('https://management.mycloud.example/.default');
            expect(env.storageEndpoint('acct')).to.equal('https://acct.blob.core.mycloud.example');
        });

        it('should fall back to public-cloud defaults and name "Custom" for a bare custom cloud', () => {
            const mock = createMockVsCode();
            mock.settings.set('microsoft-sovereign-cloud.environment', 'custom');
            mock.settings.set('microsoft-sovereign-cloud.customEnvironment', {});

            const env = getConfiguredAzureEnv(mock.vscode);
            expect(env.isCustomCloud).to.be.true;
            expect(env.name).to.equal('Custom');
            expect(getAuthProviderId(env)).to.equal(SovereignAuthProviderId);
            expect(env.resourceManagerEndpointUrl).to.equal(AzurePublicCloud.resourceManagerEndpointUrl);
            expect(env.storageEndpoint('acct')).to.equal('https://acct.blob.core.windows.net');
        });

        it('should take the login host of a custom cloud from activeDirectoryEndpointUrl', () => {
            const mock = createMockVsCode();
            mock.settings.set('microsoft-sovereign-cloud.environment', 'custom');
            mock.settings.set('microsoft-sovereign-cloud.customEnvironment', {
                activeDirectoryEndpointUrl: 'https://Login.MyCloud.example/',
            });

            expect(getConfiguredAzureEnv(mock.vscode).loginHosts).to.deep.equal(['login.mycloud.example']);
        });

        it('should keep the public login hosts for a custom cloud without activeDirectoryEndpointUrl', () => {
            const mock = createMockVsCode();
            mock.settings.set('microsoft-sovereign-cloud.environment', 'custom');
            mock.settings.set('microsoft-sovereign-cloud.customEnvironment', { activeDirectoryEndpointUrl: 'not a url' });

            expect(getConfiguredAzureEnv(mock.vscode).loginHosts).to.deep.equal(AzurePublicCloud.loginHosts);
        });

        it('should throw when custom is selected but no customEnvironment is configured', () => {
            const mock = createMockVsCode();
            mock.settings.set('microsoft-sovereign-cloud.environment', 'custom');
            expect(() => getConfiguredAzureEnv(mock.vscode)).to.throw();
        });
    });
});
