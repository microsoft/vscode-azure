/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockDataItemTree, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { ExternalError } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockOutputChannel, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { mock as nodeMock } from 'node:test';
import type * as vscode from 'vscode';
import { ConfigureCicd } from '../../../src/commands/deploy/ConfigureCicd';
import { createMockAzdService } from '../../azd/MockAzdService';
import { createMockArmProvider, createMockCodeProvider } from '../../tree/activity/MockActivityProviders';
import { createWizardCommandContainer } from '../createWizardCommandContainer';

describe('ConfigureCicd (unit)', () => {
    const sub = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Test Sub' });

    function createCommand() {
        const { ctx, mock } = createMockCodeContext();
        const azd = createMockAzdService();
        mock.workspaceFolders.push({ uri: MockUri.file('/workspace'), name: 'workspace', index: 0 });
        azd.findAzureYaml.mock.mockImplementation((dir: vscode.Uri) => {
            return Promise.resolve(dir.path === '/workspace' ? [MockUri.file('/workspace/azure.yaml')] : []);
        });

        const container = createWizardCommandContainer({
            ctx,
            output: new MockOutputChannel('test'),
            azd,
            dataTree: createMockDataItemTree([sub]),
            armProvider: createMockArmProvider(),
            codeProvider: createMockCodeProvider(),
        });
        return { cmd: container.get(ConfigureCicd), azd, mock };
    }

    it('should run pipeline config in the workspace folder', async () => {
        const { cmd, azd } = createCommand();

        await cmd.execute();

        expect(azd.pipelineConfig.mock.callCount()).to.equal(1);
        expect((azd.pipelineConfig.mock.calls[0].arguments[0]).path).to.equal('/workspace');
    });

    it('should refuse an untrusted workspace before prompting or running azd', async () => {
        const { cmd, azd, mock: mockResult } = createCommand();
        nodeMock.property(mockResult.workspace, 'isTrusted', false);

        for (const fileUri of [undefined, MockUri.file('/workspace/azure.yaml')]) {
            await expect(cmd.execute(fileUri)).to.be.rejectedWith(ExternalError, 'untrusted workspace');
        }

        expect(mockResult.quickPicks.length).to.equal(0);
        expect(azd.findAzureYaml.mock.callCount()).to.equal(0);
        expect(azd.pipelineConfig.mock.callCount()).to.equal(0);
    });

    it('should let azd prompt for the provider rather than choosing one', async () => {
        const { cmd, azd } = createCommand();

        await cmd.execute();

        expect(azd.pipelineConfig.mock.calls[0].arguments[1]).to.be.undefined;
    });

    it('should run pipeline config beside an explorer-selected azure.yaml', async () => {
        const { cmd, azd } = createCommand();

        await cmd.execute(MockUri.file('/some/project/azure.yaml'));

        expect((azd.pipelineConfig.mock.calls[0].arguments[0]).path).to.equal('/some/project');
    });

    it('should never deploy or provision, since the pipeline does that on the next push', async () => {
        const { cmd, azd } = createCommand();

        await cmd.execute();

        expect(azd.deploy.mock.callCount()).to.equal(0);
        expect(azd.provision.mock.callCount()).to.equal(0);
    });

    it('should fail when no azure.yaml can be found', async () => {
        const { cmd, azd } = createCommand();
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve([]));

        await expect(cmd.execute()).to.be.rejectedWith('azure.yaml');

        expect(azd.pipelineConfig.mock.callCount()).to.equal(0);
    });
});
