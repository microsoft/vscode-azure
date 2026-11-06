/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import { readRequiredJson } from '@microsoft/vscode-azure-utils';
import { createMockDataItemTree, createMockSubscriptionClientProvider, createMockViewItemTree, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, MockOutputChannel, MockUri, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type { AzureYamlEditor } from '../../../src/azd/AzdService';
import type * as vscode from 'vscode';
import { TempDirManager } from '../../../src/azd/TempDirManager';
import { CreateFunctionApp } from '../../../src/commands/functions/CreateFunctionApp';
import { runtimeVersions } from '../../../src/commands/functions/steps/runtimesAndVersions';
import type { IWorkspaceViewDataTree } from '../../../src/services';
import { makeFunctionsProjectNode } from '../../tree/workspace/mockWorkspaceNode';
import { createMockAzdService } from '../../azd/MockAzdService';
import { createWizardCommandContainer } from '../createWizardCommandContainer';
import { createMockArmProvider, createMockCodeProvider } from '../../tree/activity/MockActivityProviders';

describe('CreateFunctionApp (unit)', () => {
    const sub = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Test Sub' });
    const subKey = AzureNodeId.from(sub).toString();
    const project = makeFunctionsProjectNode({ resourceUri: MockUri.file('/workspace/nested/host.json') });
    const workspaceTreeOf = (node: typeof project): Pick<IWorkspaceViewDataTree, 'get'> =>
        ({ get: (key: string) => key === node.id ? node : undefined });

    function createCommand(options: { workspaceFolder?: boolean; workspaceTree?: Pick<IWorkspaceViewDataTree, 'get'> } = {}) {
        const { ctx, mock: mockResult } = createMockCodeContext();
        const output = new MockOutputChannel('test');

        if (options.workspaceFolder !== false) {
            mockResult.workspaceFolders.push({
                uri: MockUri.file('/workspace'),
                name: 'workspace',
                index: 0,
            });
        }

        const dataTree = createMockDataItemTree([sub]);
        const viewItemTree = createMockViewItemTree({ '': [subKey] });

        const subscriptionClientProvider = createMockSubscriptionClientProvider([
            { name: 'eastus', displayName: 'East US' },
            { name: 'westus', displayName: 'West US' },
        ]);

        const tempManager = new TempDirManager(ctx);

        const mockFs = mockResult.fs;
        let yamlInTemp: vscode.Uri | undefined;
        const azd = createMockAzdService();
        const setService = mock.fn<AzureYamlEditor['set']>();
        azd.updateAzureYaml.mock.mockImplementation(async (_cwd, updater) => { // eslint-disable-line @typescript-eslint/no-deprecated -- temporary azd compatibility API
            await updater({ set: setService });
        });
        azd.findAzureYaml.mock.mockImplementation((dir: vscode.Uri) => {
            const candidate = MockUri.file(`${dir.fsPath}/azure.yaml`);
            return mockFs.files.has(candidate.path)
                ? Promise.resolve([candidate])
                : yamlInTemp ? Promise.resolve([yamlInTemp]) : Promise.resolve([]);
        });
        azd.init.mock.mockImplementation((cwd: vscode.Uri) => {
            yamlInTemp = MockUri.file(`${cwd.fsPath}/azure.yaml`);
            mockFs.addFile(yamlInTemp, 'name: my-app');
            return Promise.resolve();
        });

        const armProvider = createMockArmProvider();
        const codeProvider = createMockCodeProvider();

        const container = createWizardCommandContainer({
            ctx,
            output,
            azd,
            dataTree,
            tempManager,
            viewItemTree,
            subscriptionClientProvider,
            armProvider,
            codeProvider,
            workspaceTree: options.workspaceTree,
        });
        const cmd = container.get(CreateFunctionApp);

        return { cmd, ctx, mockResult, fs: mockResult.fs, azd, dataTree, setService };
    }

    function bootstrapWorkspace(azd: ReturnType<typeof createMockAzdService>, fs: ReturnType<typeof createMockCodeContext>['mock']['fs']): void {
        const workspaceYaml = MockUri.file('/workspace/azure.yaml');
        fs.addFile(workspaceYaml, 'name: my-app\nservices:\n  api:\n    project: ./\n');
        fs.addFile(MockUri.file('/workspace/infra/main.bicep'), '// bicep');
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve([workspaceYaml]));
        azd.show.mock.mockImplementation(() => Promise.resolve({
            name: 'my-app',
            services: { api: { project: { path: './', language: 'node' } } },
        }));
        azd.envList.mock.mockImplementation(() => Promise.resolve([{ Name: 'my-app', IsDefault: true }]));
        azd.envExists.mock.mockImplementation((name: string) => Promise.resolve(name === 'my-app'));
        azd.envGetValues.mock.mockImplementation(() => Promise.resolve({
            /* eslint-disable @typescript-eslint/naming-convention -- azd env keys */
            AZURE_LOCATION: 'eastus',
            AZURE_SUBSCRIPTION_ID: 'sub-1',
            /* eslint-enable @typescript-eslint/naming-convention */
        }));
    }

    it('should run the createNew flow into the temp directory', async () => {
        const { cmd, mockResult, fs, azd } = createCommand({ workspaceFolder: false });

        respondToPrompts(mockResult, [
            { pick: 'sub-1' },                  // ChooseSubscriptionStep
            { pick: 'East US' },                // ChooseLocationStep
            { input: 'my-app' },                // ProjectNameStep
            { pick: 'Node.js' },                // PickRuntimeStep
            { pick: runtimeVersions.node[0] },                     // PickRuntimeVersionStep
        ]);

        await cmd.execute('createNew');

        expect(fs.createDirectory.mock.callCount()).to.be.greaterThanOrEqual(1);
        expect(fs.copy.mock.callCount()).to.be.greaterThanOrEqual(1);
        expect(azd.init.mock.callCount()).to.equal(1);

        expect(azd.envNew.mock.callCount()).to.equal(1);
        const [name, location, subscriptionId] = azd.envNew.mock.calls[0].arguments;
        expect(name).to.equal('my-app');
        expect(location).to.equal('eastus');
        expect(subscriptionId).to.equal('sub-1');

        expect(azd.provision.mock.callCount()).to.equal(1);
    });

    it('should run the deploy job Fresh flow against the workspace folder', async () => {
        const { cmd, mockResult, fs, azd, setService } = createCommand();

        respondToPrompts(mockResult, [
            { pick: 'sub-1' },
            { pick: 'East US' },
            { input: 'my-app' },
            { pick: 'Node.js' },
            { pick: runtimeVersions.node[0] },
        ]);

        await cmd.execute('deploy');

        expect(azd.init.mock.callCount()).to.equal(1);
        expect(fs.copy.mock.callCount()).to.be.greaterThanOrEqual(1);
        expect(azd.envNew.mock.callCount()).to.equal(1);
        expect(azd.provision.mock.callCount()).to.equal(1);
        expect(setService.mock.calls[0].arguments).to.deep.equal([
            ['services', 'my-app'], { host: 'function', project: '.', language: 'js' },
        ]);
        expect(azd.updateAzureYaml.mock.calls[0].arguments[0].path).to.equal('/workspace'); // eslint-disable-line @typescript-eslint/no-deprecated -- temporary azd compatibility API
        expect(azd.deploy.mock.callCount()).to.equal(1);
    });

    it('uses the project runtime when adding a service to existing infrastructure', async () => {
        const { cmd, mockResult, fs, azd, setService } = createCommand();
        fs.addFile(MockUri.file('/workspace/infra/main.bicep'), '// bicep');
        fs.addFile(MockUri.file('/workspace/local.settings.json'), JSON.stringify({
            Values: { ['FUNCTIONS_WORKER_RUNTIME']: 'python' },
        }));
        fs.addFile(MockUri.file('/workspace/azure.yaml'), 'name: my-app\n');
        azd.show.mock.mockImplementation(() => Promise.resolve({ name: 'my-app' }));
        respondToPrompts(mockResult, [{ pick: 'sub-1' }, { pick: 'East US' }, { input: 'my-app' }]);

        await cmd.execute('deploy');

        expect(setService.mock.calls[0].arguments).to.deep.equal([
            ['services', 'my-app'], { host: 'function', project: '.', language: 'python' },
        ]);
        expect(azd.deploy.mock.callCount()).to.equal(1);
    });

    it('resolves a runtime version for a fresh project with local runtime settings', async () => {
        const { cmd, ctx, mockResult, fs, setService } = createCommand();
        fs.addFile(MockUri.file('/workspace/local.settings.json'), JSON.stringify({
            Values: { ['FUNCTIONS_WORKER_RUNTIME']: 'node' },
        }));
        respondToPrompts(mockResult, [
            { pick: 'sub-1' }, { pick: 'East US' }, { input: 'my-app' }, { pick: runtimeVersions.node[0] },
        ]);

        await cmd.execute('deploy');

        const parameters = await readRequiredJson<{ parameters: { runtimeVersion: { value: string } } }>(
            ctx.code, MockUri.file('/workspace/infra/main.parameters.json'));
        expect(parameters.parameters.runtimeVersion.value).to.equal(runtimeVersions.node[0]);
        expect(setService.mock.calls[0].arguments[0]).to.deep.equal(['services', 'my-app']);
    });

    it('should skip yaml/bicep/env-new in the deploy job Bootstrapped flow', async () => {
        const { cmd, mockResult, fs, azd } = createCommand();

        bootstrapWorkspace(azd, mockResult.fs);

        respondToPrompts(mockResult, [
            // ProjectNameStep skipped (environmentName hydrated)
            // ChooseSubscription / ChooseLocation skipped (hydrated values)
            // PickRuntime skipped (hasInfra)
            { pick: 'Yes' },                            // ConfirmProvisionStep
        ]);

        await cmd.execute('deploy');

        expect(azd.init.mock.callCount()).to.equal(0);
        expect(fs.copy.mock.callCount()).to.equal(0);
        expect(azd.envNew.mock.callCount()).to.equal(0);
        expect(azd.provision.mock.callCount()).to.equal(1);
    });

    it('deploys the folder of a Functions workspace project node and reports a missing node', async () => {
        const { cmd, mockResult, azd, fs } = createCommand({ workspaceTree: workspaceTreeOf(project) });
        fs.addFile(project.resourceUri, '{}');
        respondToPrompts(mockResult, [
            { pick: 'sub-1' },
            { pick: 'East US' },
            { input: 'my-app' },
            { pick: 'Node.js' },
            { pick: runtimeVersions.node[0] },
        ]);

        await cmd.execute('deploy', project.id);

        expect(azd.deploy.mock.calls[0].arguments[0].path).to.equal('/workspace/nested');
        await expect(cmd.execute('deploy', `${project.id}-missing`)).to.be.rejectedWith('Refresh the workspace view');
    });

    it('should skip provisioning when user picks No on ConfirmProvisionStep', async () => {
        const { cmd, mockResult, azd } = createCommand();

        bootstrapWorkspace(azd, mockResult.fs);

        respondToPrompts(mockResult, [
            { pick: 'No' },
        ]);

        await cmd.execute('deploy');

        expect(azd.provision.mock.callCount()).to.equal(0);
    });

    it('should invalidate the data tree after execution', async () => {
        const { cmd, mockResult, dataTree } = createCommand();

        respondToPrompts(mockResult, [
            { pick: 'sub-1' },
            { pick: 'East US' },
            { input: 'my-app' },
            { pick: 'Node.js' },
            { pick: runtimeVersions.node[0] },
        ]);

        await cmd.execute('createNew');

        const invalidate = (dataTree as unknown as { invalidate: ReturnType<typeof mock.fn> }).invalidate;
        expect(invalidate.mock.callCount()).to.equal(1);
        const target = invalidate.mock.calls[0].arguments[0] as (node: unknown) => string | undefined;
        expect(target).to.be.a('function');
        expect(target(sub)).to.equal('subtree');
        expect(target(makeSubscription({ subscriptionId: 'other', displayName: 'Other' }))).to.be.undefined;
    });

    it('should invalidate by hydrated subscription when no subscription was picked', async () => {
        const { cmd, mockResult, azd, dataTree } = createCommand();

        // Bootstrapped deploy flow: the subscription picker is skipped because the
        // existing default env hydrates AZURE_SUBSCRIPTION_ID, so context.subscription
        // is never set and we must fall back to context.hydratedSubscriptionId.
        bootstrapWorkspace(azd, mockResult.fs);

        respondToPrompts(mockResult, [
            { pick: 'Yes' }, // ConfirmProvisionStep
        ]);

        await cmd.execute('deploy');

        const invalidate = (dataTree as unknown as { invalidate: ReturnType<typeof mock.fn> }).invalidate;
        expect(invalidate.mock.callCount()).to.equal(1);
        const target = invalidate.mock.calls[0].arguments[0] as (node: unknown) => string | undefined;
        expect(target).to.be.a('function');
        expect(target(sub)).to.equal('subtree');
        expect(target(makeSubscription({ subscriptionId: 'other', displayName: 'Other' }))).to.be.undefined;
    });
});
