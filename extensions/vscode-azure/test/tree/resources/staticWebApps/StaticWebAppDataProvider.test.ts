/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, isVirtualResource, type ConcreteAzureNode, type StaticSiteBuildARMResource } from '@microsoft/vscode-azure-azutils';
import { createMockVsCode, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import {
    isStaticWebAppVirtualNode,
    StaticWebAppVirtualTypes,
    type StaticWebAppEnvironment,
    type StaticWebAppFunctions,
} from '../../../../src/tree/resources/staticWebApps/StaticWebApp';
import { StaticWebAppSettingsAdapter } from '../../../../src/settings/adapters/StaticWebAppSettingsAdapter';
import { isSettingsNode, SettingsVirtualType } from '../../../../src/tree/resources/settings/SettingsNode';
import { StaticWebAppDataProvider } from '../../../../src/tree/resources/staticWebApps/StaticWebAppDataProvider';
import { makeStaticWebApp, makeStaticWebAppEnvironment, singlePage } from './mockStaticWebApp';

describe('StaticWebAppDataProvider (unit)', () => {
    function createProvider(options?: {
        readonly builds?: StaticSiteBuildARMResource[];
        readonly functionsProbeError?: boolean;
        readonly functions?: { readonly id?: string; readonly name?: string; readonly functionName?: string }[];
    }) {
        const { executor } = createTestActionExecutor();
        const getExtension = mock.fn(() => undefined);
        const code = createMockVsCode({ extensions: { getExtension } as never }).vscode;
        const builds = options?.builds ?? [{
            id: '/builds/default',
            name: 'default',
            buildId: 'default',
            sourceBranch: 'main',
            status: 'Ready',
        }];
        const probeResult = { properties: { ALPHA: 'a' } };
        const productionProbe = options?.functionsProbeError
            ? mock.fn(() => Promise.reject(new Error('No Functions API')))
            : mock.fn(() => Promise.resolve(probeResult));
        const buildProbe = options?.functionsProbeError
            ? mock.fn(() => Promise.reject(new Error('No Functions API')))
            : mock.fn(() => Promise.resolve(probeResult));
        const mockClient = {
            staticSites: {
                getStaticSite: mock.fn(() => Promise.resolve({
                    branch: 'main',
                    defaultHostname: 'site.azurestaticapps.net',
                })),
                listStaticSiteBuilds: mock.fn(() => singlePage(builds)),
                listStaticSiteFunctions: mock.fn(() => singlePage(options?.functions ?? [])),
                listStaticSiteBuildFunctions: mock.fn(() => singlePage(options?.functions ?? [])),
                listStaticSiteFunctionAppSettings: productionProbe,
                listStaticSiteBuildFunctionAppSettings: buildProbe,
            },
        };
        const settingsAdapter = new StaticWebAppSettingsAdapter(code, () => mockClient as never);
        const provider = new StaticWebAppDataProvider(executor, code, () => mockClient as never, settingsAdapter);
        return { provider, mockClient, settingsAdapter };
    }

    it('should enrich the root with site details without changing its key fields', async () => {
        const { provider } = createProvider();
        const site = makeStaticWebApp({
            staticSite: undefined,
            branch: undefined,
            defaultHostname: undefined,
        });

        expect(await provider.enrich(site)).to.be.false;
        expect(site.branch).to.equal('main');
        expect(site.defaultHostname).to.equal('site.azurestaticapps.net');
        expect(site.id).to.include('/Microsoft.Web/staticSites/mySwa');
    });

    it('should sort Production first and preview environments by label', async () => {
        const builds: StaticSiteBuildARMResource[] = [
            { buildId: '2', sourceBranch: 'GitHubAccount:b', pullRequestTitle: 'Zulu' },
            { buildId: 'default', sourceBranch: 'main' },
            { buildId: '1', sourceBranch: 'GitHubAccount:a', pullRequestTitle: 'Alpha' },
        ];
        const { provider } = createProvider({ builds });

        const children = await provider.getChildren(makeStaticWebApp());
        expect(children.map(node => isStaticWebAppVirtualNode(node) && 'displayLabel' in node ? node.displayLabel : '')).to.deep.equal([
            'Production',
            'Alpha',
            'Zulu',
        ]);
        const preview = children[1] as StaticWebAppEnvironment;
        expect(preview.branch).to.equal('a');
    });

    it('should emit an invalid environment without failing valid siblings', async () => {
        const { provider } = createProvider({
            builds: [
                { name: 'broken' },
                { buildId: 'default', sourceBranch: 'main' },
            ],
        });

        const children = await provider.getChildren(makeStaticWebApp());
        expect(children).to.have.length(2);
        expect(children.some(node => isStaticWebAppVirtualNode(node)
            && node.virtualType === StaticWebAppVirtualTypes.Invalid
            && node.invalidContextValue === 'invalidStaticEnvironment')).to.be.true;
    });

    it('should expose Functions after the production probe succeeds', async () => {
        const { provider, mockClient } = createProvider();
        const children = await provider.getChildren(makeStaticWebAppEnvironment());

        expect(virtualTypes(children)).to.deep.equal([
            SettingsVirtualType,
            StaticWebAppVirtualTypes.Functions,
        ]);
        expect(mockClient.staticSites.listStaticSiteFunctionAppSettings.mock.callCount()).to.equal(1);
        expect(mockClient.staticSites.listStaticSiteBuildFunctionAppSettings.mock.callCount()).to.equal(0);
    });

    it('should hang application settings off each environment rather than the site', async () => {
        const { provider, settingsAdapter } = createProvider();
        const environment = makeStaticWebAppEnvironment();

        const [settings] = await provider.getChildren(environment);

        expect(isSettingsNode(settings)).to.be.true;
        // Keyed beneath the environment, so production and each preview get their own document.
        expect(isSettingsNode(settings) && settings.virtualPath).to.equal('environments/default/settings');
        expect(isSettingsNode(settings) && settings.owner).to.equal(environment);
        expect(isSettingsNode(settings) && settings.adapter).to.equal(settingsAdapter);
        // Distinguishes the editor tab from the site's other environments.
        expect(isSettingsNode(settings) && settings.documentName).to.equal('mySwa-Production');
    });

    it('should point the Functions node at the build\'s own portal page', async () => {
        const { provider } = createProvider();
        const environment = makeStaticWebAppEnvironment();
        const children = await provider.getChildren(environment);

        const functions = children.find(node => isStaticWebAppVirtualNode(node)
            && node.virtualType === StaticWebAppVirtualTypes.Functions);

        // The portal has a distinct page for a build's functions, so this node
        // must not fall back to the parent site's page.
        expect(AzureNodeId.from(functions!).toPortalUrl()).to.equal(
            'https://portal.azure.com/#@test-tenant'
            + '/resource/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/staticSites/mySwa/builds/default/functions'
        );
        expect(AzureNodeId.from(environment.azureResource).toPortalUrl()).to.equal(
            'https://portal.azure.com/#@test-tenant'
            + '/resource/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/staticSites/mySwa'
        );
    });

    it('should derive the Functions portal page from the build id for a preview environment', async () => {
        const { provider } = createProvider();
        const environment = makeStaticWebAppEnvironment({
            virtualPath: 'environments/42',
            buildId: '42',
            isProduction: false,
            displayLabel: 'PR 42',
            data: { name: '42', buildId: '42', sourceBranch: 'feature' },
        });

        const children = await provider.getChildren(environment);
        const functions = children.find(node => isStaticWebAppVirtualNode(node)
            && node.virtualType === StaticWebAppVirtualTypes.Functions);

        // No ARM id on the build payload, so the id is reconstructed from the site.
        expect(AzureNodeId.from(functions!).toPortalUrl()).to.equal(
            'https://portal.azure.com/#@test-tenant'
            + '/resource/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/staticSites/mySwa/builds/42/functions'
        );
    });

    it('should use the build probe for preview environments', async () => {
        const { provider, mockClient } = createProvider();
        const environment = makeStaticWebAppEnvironment({
            virtualPath: 'environments/42',
            buildId: '42',
            branch: 'feature',
            isProduction: false,
            displayLabel: 'PR 42',
        });

        await provider.getChildren(environment);
        expect(mockClient.staticSites.listStaticSiteBuildFunctionAppSettings.mock.callCount()).to.equal(1);
        expect(mockClient.staticSites.listStaticSiteFunctionAppSettings.mock.callCount()).to.equal(0);
    });

    it('should expose Functions help when the environment has no Functions API', async () => {
        const { provider } = createProvider({ functionsProbeError: true });
        const environment = makeStaticWebAppEnvironment();

        const children = await provider.getChildren(environment);
        expect(virtualTypes(children)).to.deep.equal([
            SettingsVirtualType,
            StaticWebAppVirtualTypes.NoFunctions,
        ]);
        const help = children[1];
        expect(isStaticWebAppVirtualNode(help) && help.virtualType === StaticWebAppVirtualTypes.NoFunctions && help.kind).to.equal('help');
    });

    it('should still offer application settings when no function is deployed', async () => {
        // App settings live on the site and its builds regardless of whether a managed API exists,
        // so a failing Functions probe must not take the settings node with it.
        const { provider } = createProvider({ functionsProbeError: true });

        const children = await provider.getChildren(makeStaticWebAppEnvironment());

        expect(children.some(child => isSettingsNode(child))).to.equal(true);
    });

    it('should use production and build function-list operations and preserve empty-list semantics', async () => {
        const { provider, mockClient } = createProvider();
        const production: StaticWebAppFunctions = {
            virtualType: StaticWebAppVirtualTypes.Functions,
            virtualPath: 'environments/default/functions',
            azureResource: makeStaticWebApp(),
            environmentBuildId: 'default',
            isProduction: true,
        };
        const preview = { ...production, virtualPath: 'environments/42/functions', environmentBuildId: '42', isProduction: false };

        const productionChildren = await provider.getChildren(production);
        await provider.getChildren(preview);

        expect(mockClient.staticSites.listStaticSiteFunctions.mock.callCount()).to.equal(1);
        expect(mockClient.staticSites.listStaticSiteBuildFunctions.mock.callCount()).to.equal(1);
        expect(isStaticWebAppVirtualNode(productionChildren[0])
            && productionChildren[0].virtualType === StaticWebAppVirtualTypes.NoFunctions
            && productionChildren[0].kind).to.equal('empty');
    });

});

function virtualTypes(nodes: ConcreteAzureNode[]): string[] {
    return nodes.map(node => isVirtualResource(node) ? node.virtualType : '');
}
