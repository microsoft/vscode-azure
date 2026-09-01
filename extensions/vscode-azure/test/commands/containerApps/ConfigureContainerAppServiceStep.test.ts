/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MockUri } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import * as vscode from 'vscode';
import type { AzureYamlEditor } from '../../../src/azd/AzdService';
import { ConfigureContainerAppServiceStep } from '../../../src/commands/containerApps/steps/ConfigureContainerAppServiceStep';
import { createMockAzdService } from '../../azd/MockAzdService';

describe('ConfigureContainerAppServiceStep (unit)', () => {
    it('runs only for a deploy project without an existing service', () => {
        const step = new ConfigureContainerAppServiceStep(createMockAzdService());
        const ready = {
            job: 'deploy' as const,
            iacFolder: MockUri.file('/project'),
            azdServiceName: 'api',
        };

        expect(step.shouldExecute(ready)).to.be.true;
        expect(step.shouldExecute({ ...ready, job: 'createNew' })).to.be.false;
        expect(step.shouldExecute({ ...ready, hasServices: true })).to.be.false;
        expect(step.shouldExecute({ ...ready, iacFolder: undefined })).to.be.false;
        expect(step.shouldExecute({ ...ready, azdServiceName: undefined })).to.be.false;
    });

    it('adds the Docker Container App service to azure.yaml', async () => {
        const azd = createMockAzdService();
        const set = mock.fn<AzureYamlEditor['set']>();
        azd.updateAzureYaml.mock.mockImplementation( // eslint-disable-line @typescript-eslint/no-deprecated -- exercises the temporary compatibility API
            async (_cwd: vscode.Uri, updater: (editor: AzureYamlEditor) => void | Promise<void>) => {
                await updater({ set });
            },
        );
        const step = new ConfigureContainerAppServiceStep(azd);
        const iacFolder = MockUri.file('/project');

        await step.execute({
            job: 'deploy',
            iacFolder,
            azdServiceName: 'api',
        });

        expect(azd.updateAzureYaml.mock.callCount()).to.equal(1); // eslint-disable-line @typescript-eslint/no-deprecated -- exercises the temporary compatibility API
        expect(azd.updateAzureYaml.mock.calls[0].arguments[0]).to.equal(iacFolder); // eslint-disable-line @typescript-eslint/no-deprecated -- exercises the temporary compatibility API
        expect(set.mock.calls[0].arguments).to.deep.equal([
            ['services', 'api'],
            {
                host: 'containerapp',
                project: '.',
                language: 'docker',
            },
        ]);
    });
});
