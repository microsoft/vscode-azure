/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { ViewStaticWebAppProperties } from '../../../src/commands/staticWebApps/ViewStaticWebAppProperties';
import { makeStaticWebAppEnvironment } from '../../tree/resources/staticWebApps/mockStaticWebApp';

describe('ViewStaticWebAppProperties (unit)', () => {
    it('should refresh environment properties and omit secret-bearing fields', async () => {
        const environment = makeStaticWebAppEnvironment({
            buildId: '42',
            isProduction: false,
        });
        const { ctx, mock: mockResult } = createMockCodeContext();
        const selector = { resolve: mock.fn(() => environment) };
        const getStaticSiteBuild = mock.fn(() => Promise.resolve({
            buildId: '42',
            status: 'Ready',
            deploymentToken: 'must-not-appear',
        }));
        const command = new ViewStaticWebAppProperties(
            createActionContext('test'),
            ctx,
            (() => ({ staticSites: { getStaticSiteBuild } })) as never,
            selector as never,
        );

        await command.execute('key');

        expect(getStaticSiteBuild.mock.callCount()).to.equal(1);
        const documentOptions = mockResult.workspace.openTextDocument.mock.calls[0].arguments[0] as { content: string };
        expect(documentOptions.content).to.include('"status": "Ready"');
        expect(documentOptions.content).not.to.include('deploymentToken');
        expect(documentOptions.content).not.to.include('must-not-appear');
    });
});
