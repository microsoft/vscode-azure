/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createActionContext } from '@microsoft/vscode-azure-utils';
import { addWorkspaceFolder, createMockCodeContext, MockUri, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import type { CreateStaticWebAppContext } from '../../../src/commands/staticWebApps/CreateStaticWebAppContext';
import { getStaticWebAppBuildPreset } from '../../../src/commands/staticWebApps/buildPresets';
import { OutputLocationStep, resolveDefaultOutputLocation } from '../../../src/commands/staticWebApps/steps/OutputLocationStep';

describe('OutputLocationStep (unit)', () => {
    it('should resolve Angular output using its detected project', () => {
        const context = {
            buildPreset: getStaticWebAppBuildPreset('angular'),
            angularProjectName: 'my portal',
        } as CreateStaticWebAppContext;
        expect(resolveDefaultOutputLocation(context)).to.equal('dist/my-portal');
    });

    it('should prefer the output the project configures over the preset convention', () => {
        const context = {
            buildPreset: getStaticWebAppBuildPreset('react'),
            detectedOutputLocation: 'dist',
        } as CreateStaticWebAppContext;
        expect(resolveDefaultOutputLocation(context)).to.equal('dist');
    });

    it('should pick build output relative to the application location', async () => {
        const { ctx, mock } = createMockCodeContext();
        addWorkspaceFolder(mock, '/workspace');
        mock.fs.addFile(MockUri.file('/workspace/frontend/dist/index.html'), '<html></html>');
        const step = new OutputLocationStep(createActionContext('test'), ctx);
        respondToPrompts(mock, [{ pick: 'dist' }]);

        const result = await step.prompt({
            resourceDisplayName: 'Static Web App',
            job: 'deploy',
            iacFolder: MockUri.file('/workspace'),
            appLocation: 'frontend',
            buildPreset: getStaticWebAppBuildPreset('vuejs'),
        });

        expect(result.outputLocation).to.equal('dist');
        expect(result.deploy).to.be.true;
        expect(mock.quickPicks).to.have.length(1);
        expect(mock.inputBoxes).to.have.length(0);
    });

    it('should preserve an explicit root output selection', async () => {
        const { ctx, mock } = createMockCodeContext();
        addWorkspaceFolder(mock, '/workspace');
        const step = new OutputLocationStep(createActionContext('test'), ctx);
        respondToPrompts(mock, [{ pick: '.' }]);

        const result = await step.prompt({
            resourceDisplayName: 'Static Web App',
            job: 'deploy',
            iacFolder: MockUri.file('/workspace'),
            appLocation: '/',
            detectedOutputLocation: '/',
        });

        expect(result.outputLocation).to.equal('/');
        expect(result.deploy).to.be.false;
    });

    it('should return an empty output for the no-build choice', async () => {
        const { ctx, mock } = createMockCodeContext();
        addWorkspaceFolder(mock, '/workspace');
        const step = new OutputLocationStep(createActionContext('test'), ctx);
        respondToPrompts(mock, [{ pick: '$(circle-slash) No build output' }]);

        const result = await step.prompt({
            resourceDisplayName: 'Static Web App',
            job: 'deploy',
            iacFolder: MockUri.file('/workspace'),
            appLocation: '/',
        });

        expect(result.outputLocation).to.equal('');
        expect(result.deploy).to.be.false;
    });
});
