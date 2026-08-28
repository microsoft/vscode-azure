/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createActionContext } from '@microsoft/vscode-azure-utils';
import { addWorkspaceFolder, createMockCodeContext, MockUri, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { getStaticWebAppBuildPreset } from '../../../src/commands/staticWebApps/buildPresets';
import { AppLocationStep } from '../../../src/commands/staticWebApps/steps/AppLocationStep';

describe('AppLocationStep (unit)', () => {
    it('should offer the path already declared to the SWA CLI as the editable default', async () => {
        const { ctx, mock } = createMockCodeContext();
        addWorkspaceFolder(mock, '/workspace');
        const actionContext = createActionContext('test');
        const step = new AppLocationStep(actionContext, ctx);
        respondToPrompts(mock, ['acceptDefault']);
        mock.fs.addFile(
            MockUri.file('/workspace/swa-cli.config.json'),
            JSON.stringify({ configurations: { app: { appLocation: 'frontend' } } }),
        );

        const result = await step.prompt({
            resourceDisplayName: 'Static Web App',
            iacFolder: MockUri.file('/workspace'),
            buildPreset: getStaticWebAppBuildPreset('react'),
        });

        expect(result.appLocation).to.equal('frontend');
        expect(actionContext.telemetry.properties.appLocation).to.equal('setting');
        expect(mock.quickPicks).to.have.length(1);
        expect(mock.inputBoxes).to.have.length(0);
    });

    it('should resolve the first configuration when the SWA CLI config names several', async () => {
        const { ctx, mock } = createMockCodeContext();
        addWorkspaceFolder(mock, '/workspace');
        const step = new AppLocationStep(createActionContext('test'), ctx);
        respondToPrompts(mock, ['acceptDefault']);
        mock.fs.addFile(
            MockUri.file('/workspace/swa-cli.config.json'),
            JSON.stringify({
                configurations: { app: { appLocation: 'frontend' }, docs: { appLocation: 'website' } },
            }),
        );

        const result = await step.prompt({
            resourceDisplayName: 'Static Web App',
            iacFolder: MockUri.file('/workspace'),
            buildPreset: getStaticWebAppBuildPreset('react'),
        });

        expect(result.appLocation).to.equal('frontend');
    });

    it('should fall back to the detected path when the SWA CLI config is unreadable', async () => {
        const { ctx, mock } = createMockCodeContext();
        addWorkspaceFolder(mock, '/workspace');
        const step = new AppLocationStep(createActionContext('test'), ctx);
        respondToPrompts(mock, ['acceptDefault']);
        mock.fs.addFile(MockUri.file('/workspace/swa-cli.config.json'), '{ not json');

        const result = await step.prompt({
            resourceDisplayName: 'Static Web App',
            iacFolder: MockUri.file('/workspace'),
            detectedAppLocation: 'src',
            buildPreset: getStaticWebAppBuildPreset('react'),
        });

        expect(result.appLocation).to.equal('src');
    });
});
