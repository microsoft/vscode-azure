/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { BrowseStaticWebApp } from '../../../src/commands/staticWebApps/BrowseStaticWebApp';
import {
    CreateSwaConfigFile,
    staticWebAppExampleConfig,
} from '../../../src/commands/staticWebApps/CreateSwaConfigFile';
import { DeleteStaticWebAppEnvironment } from '../../../src/commands/staticWebApps/DeleteStaticWebAppEnvironment';
import { StaticWebAppCommandResolver } from '../../../src/commands/staticWebApps/StaticWebAppCommandResolver';
import { ViewStaticWebAppProperties } from '../../../src/commands/staticWebApps/ViewStaticWebAppProperties';
import { GenericActivityDataProvider } from '../../../src/tree/activity/GenericActivityDataProvider';
import { makeStaticWebApp, makeStaticWebAppEnvironment } from '../../tree/resources/staticWebApps/mockStaticWebApp';

describe('Static Web Apps resource commands (unit)', () => {
    function createResolver(resource: ReturnType<typeof makeStaticWebApp> | ReturnType<typeof makeStaticWebAppEnvironment>) {
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
        const selector = { select: mock.fn(() => Promise.resolve(resource)) };
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

    it('should guard production environment deletion before prompting', async () => {
        const { mockResult, resolver } = createResolver(makeStaticWebAppEnvironment());
        const deleteBuild = mock.fn(() => Promise.resolve());
        const command = new DeleteStaticWebAppEnvironment(
            createActionContext('test'),
            mockResult.vscode,
            (() => ({ staticSites: { deleteStaticSiteBuild: deleteBuild } })) as never,
            resolver,
            new GenericActivityDataProvider(),
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
            (() => ({ staticSites: { deleteStaticSiteBuild: deleteBuild } })) as never,
            resolver,
            new GenericActivityDataProvider(),
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
