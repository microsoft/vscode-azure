/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ISubscriptionClientProvider } from '@microsoft/vscode-azure-azutils';
import { createMockDataItemTree, createMockViewItemTree, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, MockOutputChannel, MockUri, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { TempProjectManager } from '../../../azd/wizard/TempProjectManager';
import { CreateFunctionApp } from '../../../commands/functions/CreateFunctionApp';
import { createMockAzdService } from '../../azd/MockAzdService';

describe('CreateFunctionApp (unit)', () => {
    const sub = makeSubscription({ subscriptionId: 'sub-1', name: 'Test Sub' });
    const subKey = AzureNodeId.from(sub).toString();

    function createCommand(options: { workspaceFolder?: boolean } = {}) {
        const { ctx, mock: mockResult } = createMockCodeContext();
        const output = new MockOutputChannel('test');

        if (options.workspaceFolder !== false) {
            mockResult.workspaceFolders.push({
                uri: MockUri.file('/workspace'),
                name: 'workspace',
                index: 0,
            } as never);
        }

        const dataTree = createMockDataItemTree([sub]);
        const viewItemTree = createMockViewItemTree({ '': [subKey] });

        const subscriptionClientProvider: ISubscriptionClientProvider = (() =>
            Promise.resolve({
                subscriptions: {
                    listLocations: mock.fn(() => [
                        { name: 'eastus', displayName: 'East US' },
                        { name: 'westus', displayName: 'West US' },
                    ]),
                },
            })
        ) as unknown as ISubscriptionClientProvider;

        const tempManager = new TempProjectManager(ctx);

        const mockFs = mockResult.fs;
        let yamlInTemp: vscode.Uri | undefined;
        const azd = createMockAzdService();
        azd.findAzureYaml.mock.mockImplementation((dir: vscode.Uri) => {
            const candidate = MockUri.file(`${dir.fsPath}/azure.yaml`);
            return mockFs.files.has(candidate.path)
                ? Promise.resolve(candidate as unknown as vscode.Uri)
                : Promise.resolve(yamlInTemp);
        });
        azd.init.mock.mockImplementation((cwd: vscode.Uri) => {
            yamlInTemp = MockUri.file(`${cwd.fsPath}/azure.yaml`) as unknown as vscode.Uri;
            mockFs.addFile(yamlInTemp, 'name: my-app');
            return Promise.resolve();
        });

        const cmd = new CreateFunctionApp(
            ctx,
            output,
            dataTree,
            viewItemTree as never,
            subscriptionClientProvider,
            tempManager,
            azd,
        );

        return { cmd, ctx, mockResult, fs: mockResult.fs, azd };
    }

    it('should be constructable with required dependencies', () => {
        const { cmd } = createCommand();
        expect(cmd).to.be.instanceOf(CreateFunctionApp);
    });

    it('should run the createNew flow into the temp directory', async () => {
        const { cmd, mockResult, fs, azd } = createCommand({ workspaceFolder: false });

        respondToPrompts(mockResult, [
            { pick: 'sub-1' },                  // ChooseSubscriptionStep
            { pick: 'East US' },                // ChooseLocationStep
            { input: 'my-app' },                // ProjectNameStep
            { pick: 'Node.js' },                // PickRuntimeStep
            { pick: 'Flex Consumption' },       // PickHostingPlanStep
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
        const { cmd, mockResult, fs, azd } = createCommand();

        respondToPrompts(mockResult, [
            { pick: 'sub-1' },
            { pick: 'East US' },
            { input: 'my-app' },
            { pick: 'Node.js' },
            { pick: 'Flex Consumption' },
        ]);

        await cmd.execute('deploy');

        expect(azd.init.mock.callCount()).to.equal(1);
        expect(fs.copy.mock.callCount()).to.be.greaterThanOrEqual(1);
        expect(azd.envNew.mock.callCount()).to.equal(1);
        expect(azd.provision.mock.callCount()).to.equal(1);
    });

    it('should skip yaml/bicep/env-new in the deploy job Bootstrapped flow', async () => {
        const { cmd, mockResult, fs, azd } = createCommand();

        const workspaceYaml = MockUri.file('/workspace/azure.yaml') as unknown as vscode.Uri;
        mockResult.fs.addFile(workspaceYaml, 'name: my-app\nservices:\n  api:\n    project: ./\n');
        mockResult.fs.addFile(MockUri.file('/workspace/infra/main.bicep'), '// bicep');
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve(workspaceYaml));
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

        respondToPrompts(mockResult, [
            // ProjectNameStep skipped (environmentName hydrated)
            // ChooseSubscription / ChooseLocation skipped (hydrated values)
            // PickRuntime / PickHostingPlan skipped (hasInfra)
            { pick: 'Yes' },                            // ConfirmProvisionStep
        ]);

        await cmd.execute('deploy');

        expect(azd.init.mock.callCount()).to.equal(0);
        expect(fs.copy.mock.callCount()).to.equal(0);
        expect(azd.envNew.mock.callCount()).to.equal(0);
        expect(azd.provision.mock.callCount()).to.equal(1);
    });

    it('should skip provisioning when user picks No on ConfirmProvisionStep', async () => {
        const { cmd, mockResult, azd } = createCommand();

        const workspaceYaml = MockUri.file('/workspace/azure.yaml') as unknown as vscode.Uri;
        mockResult.fs.addFile(workspaceYaml, 'name: my-app\nservices:\n  api:\n    project: ./\n');
        mockResult.fs.addFile(MockUri.file('/workspace/infra/main.bicep'), '// bicep');
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve(workspaceYaml));
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

        respondToPrompts(mockResult, [
            { pick: 'No' },
        ]);

        await cmd.execute('deploy');

        expect(azd.provision.mock.callCount()).to.equal(0);
    });
});
