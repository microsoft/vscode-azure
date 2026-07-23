/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import { createMockDataItemTree, createMockSubscriptionClientProvider, createMockViewItemTree, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockOutputChannel, MockUri, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import type * as vscode from 'vscode';
import { TempDirManager } from '../../../src/azd/TempDirManager';
import { CreateStaticWebApp } from '../../../src/commands/staticWebApps/CreateStaticWebApp';
import { StaticWebAppsGitHubService } from '../../../src/services/StaticWebAppsGitHubService';
import { createMockAzdService } from '../../azd/MockAzdService';
import { createMockArmProvider, createMockCodeProvider } from '../../tree/activity/MockActivityProviders';
import { createWizardCommandContainer } from '../createWizardCommandContainer';

describe('CreateStaticWebApp (unit)', () => {
    const subscription = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Test Sub' });

    function createCommand(workspace: boolean) {
        const { ctx, mock } = createMockCodeContext();
        if (workspace) {
            mock.workspaceFolders.push({ uri: MockUri.file('/workspace'), name: 'workspace', index: 0 });
        }
        const dataTree = createMockDataItemTree([subscription]);
        const viewItemTree = createMockViewItemTree({ '': [AzureNodeId.from(subscription).toString()] });
        const azd = createMockAzdService();
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
            staticWebAppsGitHubService: new StaticWebAppsGitHubService(ctx.code, ctx.extensionContext),
        });
        return { command: container.get(CreateStaticWebApp), mock, azd, actionContext };
    }

    it('should run basic mode as provision-only without a workspace', async () => {
        const { command, mock, azd, actionContext } = createCommand(false);
        respondToPrompts(mock, [
            { pick: 'sub-1' },
            { pick: 'East US 2' },
            { input: 'my-swa' },
            { pick: 'React' },
            { input: '/' },
            { input: 'build' },
        ]);

        await command.execute('basic');

        expect(actionContext.telemetry.properties.mode).to.equal('basic');
        expect(actionContext.telemetry.properties.buildPreset).to.equal('React');
        expect(azd.provision.mock.callCount()).to.equal(1);
        expect(azd.deploy.mock.callCount()).to.equal(0);
        expect(azd.init.mock.callCount()).to.equal(1);
        expect(mock.fs.files.has([...mock.fs.files.keys()].find(path => path.endsWith('/infra/main.parameters.json')) ?? '')).to.be.true;
        expect(mock.fs.copy.mock.calls.some(call => call.arguments[1].path.endsWith('/infra/staticWebApp.module.bicep'))).to.be.true;
    });

    it('should prompt for Standard and deploy supported output in advanced mode', async () => {
        const { command, mock, azd, actionContext } = createCommand(true);
        respondToPrompts(mock, [
            { pick: 'sub-1' },
            { pick: 'East US 2' },
            { input: 'my-swa' },
            { pick: 'Standard' },
            { pick: 'React' },
            { input: '/' },
            { input: 'api' },
            { input: 'build' },
        ]);

        await command.execute('advanced');

        expect(actionContext.telemetry.properties.mode).to.equal('advanced');
        expect(azd.provision.mock.callCount()).to.equal(1);
        expect(azd.deploy.mock.callCount()).to.equal(1);
        const parametersPath = [...mock.fs.files.keys()].find(path => path.endsWith('/infra/main.parameters.json'));
        const parameters = JSON.parse(Buffer.from(mock.fs.files.get(parametersPath ?? '') ?? []).toString());
        expect(parameters.parameters.staticWebAppSkuName.value).to.equal('Standard');
        expect(parameters.parameters.appLocation.value).to.equal('/');
        expect(parameters.parameters.apiLocation.value).to.equal('api');
        expect(parameters.parameters.outputLocation.value).to.equal('build');
    });
});
