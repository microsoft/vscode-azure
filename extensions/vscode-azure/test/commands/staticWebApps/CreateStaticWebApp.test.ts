/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import { createMockDataItemTree, createMockSubscriptionClientProvider, createMockViewItemTree, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockOutputChannel, MockUri, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import type * as vscode from 'vscode';
import { TempDirManager } from '../../../src/azd/TempDirManager';
import { CreateStaticWebApp } from '../../../src/commands/staticWebApps/CreateStaticWebApp';
import type { SWACLIOptions } from '../../../src/staticWebApps/SwaCliConfig';
import { createMockAzdService } from '../../azd/MockAzdService';
import { createMockSwaCliService } from '../../staticWebApps/MockSwaCliService';
import { createMockArmProvider, createMockCodeProvider } from '../../tree/activity/MockActivityProviders';
import { createWizardCommandContainer } from '../createWizardCommandContainer';

describe('CreateStaticWebApp (unit)', () => {
    const subscription = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Test Sub' });

    function createCommand(workspace: boolean, options: { readonly azdVersionOk?: boolean, readonly detected?: SWACLIOptions } = {}) {
        const { ctx, mock } = createMockCodeContext();
        if (workspace) {
            mock.workspaceFolders.push({ uri: MockUri.file('/workspace'), name: 'workspace', index: 0 });
        }
        const dataTree = createMockDataItemTree([subscription]);
        const viewItemTree = createMockViewItemTree({ '': [AzureNodeId.from(subscription).toString()] });
        const azd = createMockAzdService();
        if (options.azdVersionOk !== undefined) {
            azd.checkVersion.mock.mockImplementation(() => Promise.resolve(options.azdVersionOk));
        }
        let yamlUri: vscode.Uri | undefined;
        azd.findAzureYaml.mock.mockImplementation((folder: vscode.Uri) => {
            const candidate = MockUri.file(`${folder.fsPath}/azure.yaml`);
            return Promise.resolve(mock.fs.files.has(candidate.path) ? [candidate] : yamlUri ? [yamlUri] : []);
        });
        azd.init.mock.mockImplementation((folder: vscode.Uri) => {
            yamlUri = MockUri.file(`${folder.fsPath}/azure.yaml`);
            mock.fs.addFile(yamlUri, 'name: test\n');
            return Promise.resolve();
        });
        const actionContext = createActionContext('test');
        const container = createWizardCommandContainer({
            ctx,
            output: new MockOutputChannel('test'),
            azd,
            dataTree,
            actionContext,
            tempManager: new TempDirManager(ctx),
            viewItemTree,
            subscriptionClientProvider: createMockSubscriptionClientProvider([
                { name: 'eastus', displayName: 'East US' },
                { name: 'eastus2', displayName: 'East US 2' },
            ]),
            armProvider: createMockArmProvider(),
            codeProvider: createMockCodeProvider(),
            swaCli: createMockSwaCliService(options.detected ?? { appLocation: '/', apiLocation: '', outputLocation: 'build' }),
        });
        return { command: container.get(CreateStaticWebApp), mock, azd, actionContext };
    }

    it('should provision only when no workspace is open', async () => {
        const { command, mock, azd, actionContext } = createCommand(false);
        respondToPrompts(mock, [
            { pick: 'sub-1' },
            { pick: 'East US 2' },
            { input: 'my-swa' },
            'acceptDefault',
        ]);

        await command.execute();

        expect(actionContext.telemetry.properties.swaLayoutSource).to.equal('cli');
        expect(azd.provision.mock.callCount()).to.equal(1);
        expect(azd.deploy.mock.callCount()).to.equal(0);
        expect(azd.init.mock.callCount()).to.equal(1);
        expect(mock.fs.files.has([...mock.fs.files.keys()].find(path => path.endsWith('/infra/main.parameters.json')) ?? '')).to.be.true;
        expect(mock.fs.copy.mock.calls.some(call => call.arguments[1].path.endsWith('/infra'))).to.be.true;
    });

    it('should deploy supported output when a workspace is open', async () => {
        const { command, mock, azd } = createCommand(true);
        respondToPrompts(mock, [
            { pick: 'sub-1' },
            { pick: 'East US 2' },
            { input: 'my-swa' },
            'acceptDefault',
        ]);

        await command.execute();

        expect(azd.provision.mock.callCount()).to.equal(1);
        expect(azd.deploy.mock.callCount()).to.equal(1);
        const parametersPath = [...mock.fs.files.keys()].find(path => path.endsWith('/infra/main.parameters.json'));
        const parameters = JSON.parse(Buffer.from(mock.fs.files.get(parametersPath ?? '') ?? []).toString());
        expect(parameters.parameters.appLocation.value).to.equal('/');
        expect(parameters.parameters.apiLocation.value).to.equal('');
        expect(parameters.parameters.outputLocation.value).to.equal('build');
        const configPath = [...mock.fs.files.keys()].find(path => path.endsWith('/swa-cli.config.json'));
        const config = JSON.parse(Buffer.from(mock.fs.files.get(configPath ?? '') ?? []).toString());
        expect(config.configurations.detected).to.deep.equal({
            appLocation: '/',
            apiLocation: '',
            outputLocation: 'build',
        });
    });
});
