/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockOutputChannel, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { BrowseStaticWebApp } from '../../../src/commands/staticWebApps/BrowseStaticWebApp';
import { CloneRepository } from '../../../src/commands/staticWebApps/CloneRepository';
import {
    CreateSwaConfigFile,
    staticWebAppExampleConfig,
} from '../../../src/commands/staticWebApps/CreateSwaConfigFile';
import { DeleteStaticWebAppEnvironment } from '../../../src/commands/staticWebApps/DeleteStaticWebAppEnvironment';
import { OpenGitHubRepository } from '../../../src/commands/staticWebApps/OpenGitHubRepository';
import { ShowGitHubActions } from '../../../src/commands/staticWebApps/ShowGitHubActions';
import { StaticWebAppCommandResolver } from '../../../src/commands/staticWebApps/StaticWebAppCommandResolver';
import { ViewStaticWebAppProperties } from '../../../src/commands/staticWebApps/ViewStaticWebAppProperties';
import {
    StaticWebAppVirtualTypes,
    type StaticWebAppActions,
} from '../../../src/tree/resources/staticWebApps/StaticWebApp';
import { makeStaticWebApp, makeStaticWebAppEnvironment } from '../../tree/resources/staticWebApps/mockStaticWebApp';

describe('Static Web Apps resource commands (unit)', () => {
    function createResolver(resource: ReturnType<typeof makeStaticWebApp> | ReturnType<typeof makeStaticWebAppEnvironment> | StaticWebAppActions) {
        const { ctx, mock: mockResult } = createMockCodeContext();
        const invalidate = mock.fn();
        const remove = mock.fn();
        const cache = {
            get: mock.fn((key: string) => key === 'key' ? resource : undefined),
            getChildren: mock.fn(() => Promise.resolve([])),
            invalidate,
            remove,
            whenEnriched: mock.fn((site: unknown) => Promise.resolve(site)),
        };
        const selector = { select: mock.fn(() => Promise.resolve(isActions(resource) ? resource.azureResource : resource)) };
        const resolver = new StaticWebAppCommandResolver(ctx, cache as never, selector as never);
        return { ctx, mockResult, cache, invalidate, remove, resolver };
    }

    it('should browse environment and site hostnames using HTTPS', async () => {
        const environment = makeStaticWebAppEnvironment({ hostname: 'preview.azurestaticapps.net' });
        const { mockResult, resolver } = createResolver(environment);
        await new BrowseStaticWebApp(mockResult.vscode, resolver).execute('key');

        expect(mockResult.env.openExternal.mock.calls[0].arguments[0].toString()).to.equal(
            'https://preview.azurestaticapps.net/',
        );
    });

    it('should clone the linked repository through git.clone', async () => {
        const { mockResult, resolver } = createResolver(makeStaticWebApp());
        await new CloneRepository(mockResult.vscode, resolver).execute('key');

        expect(mockResult.commands.executeCommand.mock.calls[0].arguments).to.deep.equal([
            'git.clone',
            'https://github.com/octo-org/octo-repo',
        ]);
    });

    it('should construct branch and Actions GitHub URLs', async () => {
        const environment = makeStaticWebAppEnvironment({ branch: 'feature/my change' });
        const environmentHarness = createResolver(environment);
        const github = { parseRepositoryUrl: () => ({ owner: 'octo-org', repo: 'octo-repo' }) };
        await new OpenGitHubRepository(
            environmentHarness.mockResult.vscode,
            environmentHarness.resolver,
            github as never,
        ).execute('key');
        expect(environmentHarness.mockResult.env.openExternal.mock.calls[0].arguments[0].toString()).to.equal(
            'https://github.com/octo-org/octo-repo/tree/feature/my%20change',
        );

        const actions: StaticWebAppActions = {
            virtualType: StaticWebAppVirtualTypes.Actions,
            virtualPath: 'environments/default/actions',
            azureResource: makeStaticWebApp(),
            environmentBuildId: 'default',
            branch: 'main',
            repository: { owner: 'octo-org', repo: 'octo-repo' },
        };
        const actionsHarness = createResolver(actions);
        await new ShowGitHubActions(
            actionsHarness.mockResult.vscode,
            actionsHarness.resolver,
            github as never,
        ).execute('key');
        expect(actionsHarness.mockResult.env.openExternal.mock.calls[0].arguments[0].toString()).to.equal(
            'https://github.com/octo-org/octo-repo/actions',
        );
    });

    it('should guard production environment deletion before prompting', async () => {
        const { mockResult, resolver } = createResolver(makeStaticWebAppEnvironment());
        const deleteBuild = mock.fn(() => Promise.resolve());
        const command = new DeleteStaticWebAppEnvironment(
            createActionContext('test'),
            mockResult.vscode,
            new MockOutputChannel('test'),
            (() => ({ staticSites: { deleteStaticSiteBuild: deleteBuild } })) as never,
            resolver,
        );

        let error: unknown;
        try {
            await command.execute('key');
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.include('Cannot delete the production environment');
        expect(deleteBuild.mock.callCount()).to.equal(0);
        expect(mockResult.window.showWarningMessage.mock.callCount()).to.equal(0);
    });

    it('should delete a confirmed preview environment and remove only that node', async () => {
        const environment = makeStaticWebAppEnvironment({
            buildId: '42',
            isProduction: false,
            displayLabel: 'PR 42',
        });
        const { mockResult, resolver, remove } = createResolver(environment);
        respondToPrompts(mockResult, [{ button: 'Delete' }]);
        const deleteBuild = mock.fn(() => Promise.resolve());
        const command = new DeleteStaticWebAppEnvironment(
            createActionContext('test'),
            mockResult.vscode,
            new MockOutputChannel('test'),
            (() => ({ staticSites: { deleteStaticSiteBuild: deleteBuild } })) as never,
            resolver,
        );

        await command.execute('key');
        expect(deleteBuild.mock.calls[0].arguments.slice(0, 3)).to.deep.equal(['rg1', 'mySwa', '42']);
        expect(remove.mock.calls[0].arguments[0]).to.equal(environment);
    });

    it('should honor config overwrite cancellation and write the exact example when confirmed', async () => {
        const { mock: mockResult } = createMockCodeContext();
        const folderUri = mockResult.vscode.Uri.file('/workspace');
        mockResult.workspaceFolders.push({ uri: folderUri, name: 'workspace', index: 0 });
        const configUri = mockResult.vscode.Uri.joinPath(folderUri, 'staticwebapp.config.json');
        mockResult.fs.addFile(configUri, 'existing');
        const command = new CreateSwaConfigFile(mockResult.vscode);

        let error: unknown;
        try {
            await command.execute();
        } catch (caught) {
            error = caught;
        }
        expect(CancellationError.test(error)).to.equal(true);
        expect(new TextDecoder().decode(mockResult.fs.files.get(configUri.path))).to.equal('existing');

        respondToPrompts(mockResult, [{ button: 'Overwrite' }]);
        await command.execute();
        expect(new TextDecoder().decode(mockResult.fs.files.get(configUri.path))).to.equal(staticWebAppExampleConfig);
    });

    it('should refresh environment properties and omit secret-bearing fields', async () => {
        const environment = makeStaticWebAppEnvironment({
            buildId: '42',
            isProduction: false,
        });
        const { ctx, mockResult, resolver } = createResolver(environment);
        const getStaticSiteBuild = mock.fn(() => Promise.resolve({
            buildId: '42',
            status: 'Ready',
            deploymentToken: 'must-not-appear',
        }));
        const command = new ViewStaticWebAppProperties(
            createActionContext('test'),
            ctx,
            (() => ({ staticSites: { getStaticSiteBuild } })) as never,
            {} as never,
            resolver,
        );

        await command.execute('key');

        expect(getStaticSiteBuild.mock.callCount()).to.equal(1);
        const documentOptions = mockResult.workspace.openTextDocument.mock.calls[0].arguments[0] as { content: string };
        expect(documentOptions.content).to.include('"status": "Ready"');
        expect(documentOptions.content).not.to.include('deploymentToken');
        expect(documentOptions.content).not.to.include('must-not-appear');
    });
});

function isActions(value: unknown): value is StaticWebAppActions {
    return !!value && typeof value === 'object' && 'virtualType' in value
        && value.virtualType === StaticWebAppVirtualTypes.Actions;
}
