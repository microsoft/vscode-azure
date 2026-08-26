/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import { createMockDataItemTree, createMockSubscriptionClientProvider, createMockViewItemTree, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockOutputChannel, MockUri, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock as nodeMock } from 'node:test';
import type * as vscode from 'vscode';
import { TempDirManager } from '../../../src/azd/TempDirManager';
import { CreateStaticWebApp } from '../../../src/commands/staticWebApps/CreateStaticWebApp';
import { DeployStaticWebAppCommandId } from '../../../src/constants';
import type { GitRemoteInfo, IGitRemoteService } from '../../../src/staticWebApps/GitRemoteService';
import { createMockAzdService } from '../../azd/MockAzdService';
import { createMockArmProvider, createMockCodeProvider } from '../../tree/activity/MockActivityProviders';
import { createWizardCommandContainer } from '../createWizardCommandContainer';

describe('CreateStaticWebApp (unit)', () => {
    const subscription = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Test Sub' });

    /**
     * Counts only launches of the Static Web Apps deployment follow-up command.
     * Unrelated commands (for example the activity view focus issued by
     * {@linkcode AzdDeployStep}) must never be mistaken for a routing decision.
     */
    function deployLaunchCount(mock: { readonly commands: { readonly executeCommand: { readonly mock: { readonly calls: readonly { readonly arguments: readonly unknown[] }[] } } } }): number {
        return mock.commands.executeCommand.mock.calls.filter(call => call.arguments[0] === DeployStaticWebAppCommandId).length;
    }

    function createCommand(workspace: boolean, options: { readonly remote?: GitRemoteInfo; readonly azdVersionOk?: boolean } = {}) {
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
        const gitRemote = { getRemoteInfo: nodeMock.fn(() => Promise.resolve(options.remote)) } as unknown as IGitRemoteService;
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
            gitRemote,
        });
        return { command: container.get(CreateStaticWebApp), mock, azd, actionContext, gitRemote };
    }

    it('should provision only when no workspace is open', async () => {
        const { command, mock, azd, actionContext } = createCommand(false);
        respondToPrompts(mock, [
            { pick: 'sub-1' },
            { pick: 'East US 2' },
            { input: 'my-swa' },
            { pick: 'React' },
            { input: '/' },
            { input: 'build' },
        ]);

        await command.execute();

        expect(actionContext.telemetry.properties.buildPreset).to.equal('React');
        expect(azd.provision.mock.callCount()).to.equal(1);
        expect(azd.deploy.mock.callCount()).to.equal(0);
        expect(azd.init.mock.callCount()).to.equal(1);
        expect(mock.fs.files.has([...mock.fs.files.keys()].find(path => path.endsWith('/infra/main.parameters.json')) ?? '')).to.be.true;
        expect(mock.fs.copy.mock.calls.some(call => call.arguments[1].path.endsWith('/infra/main.bicep'))).to.be.true;
    });

    it('should deploy supported output when a workspace is open', async () => {
        const { command, mock, azd } = createCommand(true);
        respondToPrompts(mock, [
            { pick: 'sub-1' },
            { pick: 'East US 2' },
            { input: 'my-swa' },
            { pick: 'React' },
            { input: '/' },
            { input: 'build' },
        ]);

        await command.execute();

        expect(azd.provision.mock.callCount()).to.equal(1);
        expect(azd.deploy.mock.callCount()).to.equal(1);
        const parametersPath = [...mock.fs.files.keys()].find(path => path.endsWith('/infra/main.parameters.json'));
        const parameters = JSON.parse(Buffer.from(mock.fs.files.get(parametersPath ?? '') ?? []).toString());
        expect(parameters.parameters.appLocation.value).to.equal('/');
        expect(parameters.parameters.apiLocation.value).to.equal('');
        expect(parameters.parameters.outputLocation.value).to.equal('build');
    });

    describe('deployment routing', () => {
        const githubPushed: GitRemoteInfo = { provider: 'github', url: 'https://github.com/o/r.git', hasUpstream: true, branch: 'main' };

        it('should launch CI/CD setup and skip direct deploy for a supported, pushed remote', async () => {
            const { command, mock, azd } = createCommand(true, { remote: githubPushed });
            respondToPrompts(mock, [
                { pick: 'sub-1' },
                { pick: 'East US 2' },
                { input: 'my-swa' },
                { pick: 'React' },
                { input: '/' },
                { input: 'build' },
            ]);

            await command.execute();
            // Let the fire-and-forget executeCommand().then(...) settle.
            await Promise.resolve();

            expect(azd.provision.mock.callCount()).to.equal(1);
            expect(azd.deploy.mock.callCount()).to.equal(0);
            expect(azd.pipelineConfig.mock.callCount()).to.equal(0); // launched command is separate/mocked, not this azd instance's method directly
            // ShowEndpointUrlStep is gated on deploy===true, so a CI-routed flow (deploy:false)
            // never claims "Application deployed" -- the launched CI command owns its own messaging.
            expect(mock.window.showInformationMessage.mock.calls.some(call =>
                typeof call.arguments[0] === 'string' && call.arguments[0].includes('Application deployed'))).to.be.false;
            expect(deployLaunchCount(mock)).to.equal(1);
            const launch = mock.commands.executeCommand.mock.calls.find(call => call.arguments[0] === DeployStaticWebAppCommandId);
            const [commandId, args] = launch!.arguments as [string, { readonly provider: string; readonly artifactSupportsAutoDeploy: boolean }];
            expect(commandId).to.equal('vscode-azure/staticWebApps/deploy');
            expect(args.provider).to.equal('github');
            // Creation already confirmed the artifact supports auto-deploy (that's why
            // deploymentRoute was set) -- trust it explicitly rather than letting the launched
            // command re-detect and potentially contradict it.
            expect(args.artifactSupportsAutoDeploy).to.be.true;
        });

        it('should log and not throw when the CI/CD launch command rejects', async () => {
            const { command, mock, azd } = createCommand(true, { remote: githubPushed });
            mock.commands.executeCommand.mock.mockImplementation(() => Promise.reject(new Error('boom')));
            respondToPrompts(mock, [
                { pick: 'sub-1' },
                { pick: 'East US 2' },
                { input: 'my-swa' },
                { pick: 'React' },
                { input: '/' },
                { input: 'build' },
            ]);

            await command.execute();
            await Promise.resolve();
            await Promise.resolve();

            expect(azd.provision.mock.callCount()).to.equal(1);
        });

        it('should retain direct deploy when no remote is known', async () => {
            const { command, mock, azd } = createCommand(true);
            respondToPrompts(mock, [
                { pick: 'sub-1' },
                { pick: 'East US 2' },
                { input: 'my-swa' },
                { pick: 'React' },
                { input: '/' },
                { input: 'build' },
            ]);

            await command.execute();

            expect(azd.deploy.mock.callCount()).to.equal(1);
            expect(deployLaunchCount(mock)).to.equal(0);
        });

        it('should show blocked guidance (never claiming success) for hybrid/SSR output with no remote', async () => {
            const { command, mock, azd } = createCommand(true);
            respondToPrompts(mock, [
                { pick: 'sub-1' },
                { pick: 'East US 2' },
                { input: 'my-swa' },
                { pick: 'Next.js (SSR)' },
                { input: '/' },
                { input: '' },
            ]);

            await command.execute();

            expect(azd.deploy.mock.callCount()).to.equal(0);
            expect(deployLaunchCount(mock)).to.equal(0);
            // OutputLocationStep already warns during prompting for unsupported direct-deploy
            // shapes; our post-wizard guidance is an additional, final call.
            expect(mock.window.showWarningMessage.mock.callCount()).to.be.greaterThanOrEqual(2);
            const lastCall = mock.window.showWarningMessage.mock.calls.at(-1);
            const [message] = lastCall!.arguments as unknown as [string];
            expect(message).to.include('cannot currently be deployed');
            expect(message).to.not.include('deployed:');
        });

        it('should never route Next.js hybrid/SSR to CI/CD even with a supported, pushed remote (BLOCKER fix)', async () => {
            const { command, mock, azd } = createCommand(true, { remote: githubPushed });
            respondToPrompts(mock, [
                { pick: 'sub-1' },
                { pick: 'East US 2' },
                { input: 'my-swa' },
                { pick: 'Next.js (SSR)' },
                { input: '/' },
                { input: '' },
            ]);

            await command.execute();

            expect(azd.deploy.mock.callCount()).to.equal(0);
            expect(azd.pipelineConfig.mock.callCount()).to.equal(0);
            expect(deployLaunchCount(mock)).to.equal(0);
            const lastCall = mock.window.showWarningMessage.mock.calls.at(-1);
            const [message] = lastCall!.arguments as unknown as [string];
            expect(message).to.include('cannot currently be deployed');
        });
    });
});
