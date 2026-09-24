/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createActionContext, ExternalError } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { DeleteStaticWebAppEnvironment } from '../../../src/commands/staticWebApps/DeleteStaticWebAppEnvironment';
import { GenericActivityDataProvider } from '../../../src/tree/activity/GenericActivityDataProvider';
import { makeStaticWebAppEnvironment } from '../../tree/resources/staticWebApps/mockStaticWebApp';

describe('DeleteStaticWebAppEnvironment (unit)', () => {
    function createHarness(environment: ReturnType<typeof makeStaticWebAppEnvironment>) {
        const { mock: mockResult } = createMockCodeContext();
        const remove = mock.fn();
        const dataTree = { remove };
        const selectVirtual = mock.fn((_options: { readonly key?: string }) => Promise.resolve(environment));
        const selector = { selectVirtual };
        return { dataTree, mockResult, remove, selector };
    }

    it('should guard production environment deletion before prompting', async () => {
        const environment = makeStaticWebAppEnvironment();
        const { dataTree, mockResult, selector } = createHarness(environment);
        const deleteBuild = mock.fn(() => Promise.resolve());
        const actionContext = createActionContext('test');
        const command = new DeleteStaticWebAppEnvironment(
            actionContext,
            mockResult.vscode,
            (() => ({ staticSites: { deleteStaticSiteBuild: deleteBuild } })) as never,
            selector as never,
            dataTree as never,
            new GenericActivityDataProvider(),
        );

        await expect(command.execute('key')).to.be.rejectedWith(ExternalError, 'Cannot delete the production environment');
        expect(actionContext.telemetry.properties.isProduction).to.equal('true');
        expect(deleteBuild.mock.callCount()).to.equal(0);
        expect(mockResult.window.showWarningMessage.mock.callCount()).to.equal(0);
    });

    it('should delete a confirmed preview environment and remove only that node', async () => {
        const environment = makeStaticWebAppEnvironment({
            buildId: '42',
            isProduction: false,
            data: { pullRequestTitle: 'PR 42' },
        });
        const { dataTree, mockResult, remove, selector } = createHarness(environment);
        respondToPrompts(mockResult, [{ button: 'Delete' }]);
        const deleteBuild = mock.fn(() => Promise.resolve());
        const command = new DeleteStaticWebAppEnvironment(
            createActionContext('test'),
            mockResult.vscode,
            (() => ({ staticSites: { deleteStaticSiteBuild: deleteBuild } })) as never,
            selector as never,
            dataTree as never,
            new GenericActivityDataProvider(),
        );

        await command.execute('key');
        expect(deleteBuild.mock.calls[0].arguments.slice(0, 3)).to.deep.equal(['rg1', 'mySwa', '42']);
        expect(remove.mock.calls[0].arguments[0]).to.equal(environment);
        expect(selector.selectVirtual.mock.calls[0].arguments[0].key).to.equal('key');
    });

    it('should prompt for an environment when invoked from the command palette', async () => {
        const environment = makeStaticWebAppEnvironment({ isProduction: false });
        const { dataTree, mockResult, selector } = createHarness(environment);
        respondToPrompts(mockResult, [{ button: 'Delete' }]);
        const command = new DeleteStaticWebAppEnvironment(
            createActionContext('test'),
            mockResult.vscode,
            (() => ({ staticSites: { deleteStaticSiteBuild: mock.fn(() => Promise.resolve()) } })) as never,
            selector as never,
            dataTree as never,
            new GenericActivityDataProvider(),
        );

        await command.execute();

        expect(selector.selectVirtual.mock.calls[0].arguments[0].key).to.be.undefined;
    });
});
