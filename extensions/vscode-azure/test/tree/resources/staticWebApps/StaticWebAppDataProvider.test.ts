/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConcreteAzureNode, StaticSiteBuildARMResource } from '@microsoft/vscode-azure-azutils';
import { createMockVsCode, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type { GitHubJob, GitHubWorkflowRun } from '../../../../src/services/StaticWebAppsGitHubService';
import {
    isStaticWebAppVirtualNode,
    StaticWebAppVirtualTypes,
    type StaticWebAppActions,
    type StaticWebAppAppSettingsGroup,
    type StaticWebAppEnvironment,
    type StaticWebAppFunctions,
} from '../../../../src/tree/resources/staticWebApps/StaticWebApp';
import { StaticWebAppDataProvider } from '../../../../src/tree/resources/staticWebApps/StaticWebAppDataProvider';
import { makeStaticWebApp, makeStaticWebAppEnvironment, singlePage } from './mockStaticWebApp';

describe('StaticWebAppDataProvider (unit)', () => {
    function createProvider(options?: {
        readonly builds?: StaticSiteBuildARMResource[];
        readonly settingsProbeError?: boolean;
        readonly workflowRuns?: GitHubWorkflowRun[];
        readonly jobs?: GitHubJob[];
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
        const settingsResult = { properties: { ALPHA: 'a' } };
        const productionProbe = options?.settingsProbeError
            ? mock.fn(() => Promise.reject(new Error('No Functions API')))
            : mock.fn(() => Promise.resolve(settingsResult));
        const buildProbe = options?.settingsProbeError
            ? mock.fn(() => Promise.reject(new Error('No Functions API')))
            : mock.fn(() => Promise.resolve(settingsResult));
        const mockClient = {
            staticSites: {
                getStaticSite: mock.fn(() => Promise.resolve({
                    repositoryUrl: 'https://github.com/octo-org/octo-repo',
                    branch: 'main',
                    defaultHostname: 'site.azurestaticapps.net',
                })),
                listStaticSiteBuilds: mock.fn(() => singlePage(builds)),
                listStaticSiteFunctions: mock.fn(() => singlePage(options?.functions ?? [])),
                listStaticSiteBuildFunctions: mock.fn(() => singlePage(options?.functions ?? [])),
                listStaticSiteFunctionAppSettings: productionProbe,
                listStaticSiteBuildFunctionAppSettings: buildProbe,
                createOrUpdateStaticSiteFunctionAppSettings: mock.fn((_rg: string, _name: string, body: unknown) => Promise.resolve(body)),
                createOrUpdateStaticSiteBuildFunctionAppSettings: mock.fn((_rg: string, _name: string, _build: string, body: unknown) => Promise.resolve(body)),
            },
        };
        const github = {
            parseRepositoryUrl: mock.fn((url: string | undefined) => url ? { owner: 'octo-org', repo: 'octo-repo' } : undefined),
            listWorkflowRuns: mock.fn(() => Promise.resolve(options?.workflowRuns ?? [])),
            listJobs: mock.fn(() => Promise.resolve(options?.jobs ?? [])),
        };
        const provider = new StaticWebAppDataProvider(executor, code, () => mockClient as never, github as never);
        return { provider, mockClient, github };
    }

    it('should enrich the root with site details without changing its key fields', async () => {
        const { provider } = createProvider();
        const site = makeStaticWebApp({
            staticSite: undefined,
            repositoryUrl: undefined,
            branch: undefined,
            defaultHostname: undefined,
        });

        expect(await provider.enrich(site)).to.be.false;
        expect(site.repositoryUrl).to.equal('https://github.com/octo-org/octo-repo');
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

    it('should expose Actions, App Settings, and Functions after the production probe succeeds', async () => {
        const { provider, mockClient } = createProvider();
        const children = await provider.getChildren(makeStaticWebAppEnvironment());

        expect(virtualTypes(children)).to.deep.equal([
            StaticWebAppVirtualTypes.Actions,
            StaticWebAppVirtualTypes.AppSettings,
            StaticWebAppVirtualTypes.Functions,
        ]);
        expect(mockClient.staticSites.listStaticSiteFunctionAppSettings.mock.callCount()).to.equal(1);
        expect(mockClient.staticSites.listStaticSiteBuildFunctionAppSettings.mock.callCount()).to.equal(0);
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

    it('should expose source-compatible help and avoid GitHub calls for an unlinked site', async () => {
        const { provider, github } = createProvider({ settingsProbeError: true });
        const environment = makeStaticWebAppEnvironment({
            azureResource: makeStaticWebApp({ repositoryUrl: undefined }),
        });

        const children = await provider.getChildren(environment);
        expect(virtualTypes(children)).to.deep.equal([
            StaticWebAppVirtualTypes.Actions,
            StaticWebAppVirtualTypes.NoFunctions,
        ]);
        const help = children[1];
        expect(isStaticWebAppVirtualNode(help) && help.virtualType === StaticWebAppVirtualTypes.NoFunctions && help.kind).to.equal('help');
        expect(github.listWorkflowRuns.mock.callCount()).to.equal(0);
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

    it('should route preview app-settings updates through build endpoints', async () => {
        const { provider, mockClient } = createProvider();
        const group: StaticWebAppAppSettingsGroup = {
            virtualType: StaticWebAppVirtualTypes.AppSettings,
            virtualPath: 'environments/42/appSettings',
            azureResource: makeStaticWebApp(),
            environmentBuildId: '42',
            isProduction: false,
            branch: 'feature',
        };

        await provider.getChildren(group);
        await provider.addOrUpdateAppSetting(group, 'BETA', 'b');

        expect(provider.getAppSettingValue(group, 'BETA')).to.equal('b');
        expect(mockClient.staticSites.createOrUpdateStaticSiteBuildFunctionAppSettings.mock.callCount()).to.equal(1);
        expect(mockClient.staticSites.createOrUpdateStaticSiteFunctionAppSettings.mock.callCount()).to.equal(0);
    });

    it('should create invalid action nodes per item and sort jobs by start time', async () => {
        /* eslint-disable @typescript-eslint/naming-convention -- GitHub REST response fixtures */
        const validRun = {
            id: 1,
            status: 'completed',
            conclusion: 'success',
            head_branch: 'main',
            head_sha: 'abc',
            event: 'push',
            head_commit: { message: 'Valid run' },
        } as GitHubWorkflowRun;
        const invalidRun = {
            ...validRun,
            id: 2,
            status: 'waiting',
            head_commit: { message: 'Invalid run' },
        } as GitHubWorkflowRun;
        const jobs = [
            { id: 2, name: 'Later', status: 'completed', conclusion: 'success', started_at: '2026-01-02T00:00:00Z', steps: [] },
            { id: 1, name: 'Earlier', status: 'completed', conclusion: 'success', started_at: '2026-01-01T00:00:00Z', steps: [] },
        ] as unknown as GitHubJob[];
        /* eslint-enable @typescript-eslint/naming-convention */
        const { provider } = createProvider({ workflowRuns: [validRun, invalidRun], jobs });
        const group: StaticWebAppActions = {
            virtualType: StaticWebAppVirtualTypes.Actions,
            virtualPath: 'environments/default/actions',
            azureResource: makeStaticWebApp(),
            environmentBuildId: 'default',
            branch: 'main',
            repository: { owner: 'octo-org', repo: 'octo-repo' },
        };

        const actions = await provider.getChildren(group);
        expect(virtualTypes(actions)).to.deep.equal([
            StaticWebAppVirtualTypes.Action,
            StaticWebAppVirtualTypes.Invalid,
        ]);
        const sortedJobs = await provider.getChildren(actions[0]);
        expect(sortedJobs.map(node => isStaticWebAppVirtualNode(node)
            && node.virtualType === StaticWebAppVirtualTypes.Job ? node.job.name : '')).to.deep.equal(['Earlier', 'Later']);
    });
});

function virtualTypes(nodes: ConcreteAzureNode[]): string[] {
    return nodes.map(node => isStaticWebAppVirtualNode(node) ? node.virtualType : '');
}
