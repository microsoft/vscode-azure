/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext } from '@microsoft/vscode-azure-utils/testing';
import { getStaticWebAppBuildPreset } from '../../../src/commands/staticWebApps/buildPresets';
import { ApiLocationStep } from '../../../src/commands/staticWebApps/steps/ApiLocationStep';

describe('ApiLocationStep (unit)', () => {
    it('should auto-select exactly one detected Functions API', async () => {
        const { ctx, mock } = createMockCodeContext();
        const step = new ApiLocationStep(createActionContext('test'), ctx);
        const result = await step.prompt({
            resourceDisplayName: 'Static Web App',
            detectedApiLocations: ['services/api'],
            buildPreset: getStaticWebAppBuildPreset('react'),
        });

        expect(result.apiLocation).to.equal('services/api');
        expect(mock.inputBoxes).to.have.length(0);
        expect(mock.quickPicks).to.have.length(0);
    });

    it('should leave the API empty when the project has no Functions app', async () => {
        const { ctx, mock } = createMockCodeContext();
        const step = new ApiLocationStep(createActionContext('test'), ctx);
        const result = await step.prompt({
            resourceDisplayName: 'Static Web App',
            detectedApiLocations: [],
            buildPreset: getStaticWebAppBuildPreset('react'),
        });

        expect(result.apiLocation).to.equal('');
        expect(mock.inputBoxes).to.have.length(0);
    });

    it('should keep the preset API when the framework build emits one', async () => {
        const { ctx, mock } = createMockCodeContext();
        const step = new ApiLocationStep(createActionContext('test'), ctx);
        const result = await step.prompt({
            resourceDisplayName: 'Static Web App',
            detectedApiLocations: [],
            buildPreset: getStaticWebAppBuildPreset('svelte-kit'),
        });

        expect(result.apiLocation).to.equal('build/server');
        expect(mock.inputBoxes).to.have.length(0);
    });
});
