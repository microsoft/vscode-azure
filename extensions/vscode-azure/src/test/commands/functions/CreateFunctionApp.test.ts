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
import { CreateFunctionApp } from '../../../commands/functions/CreateFunctionApp';
import type { IExecAzd } from '../../../utils/azdUtils';
import { TempProjectManager } from '../../../wizard/azd/TempProjectManager';

describe('CreateFunctionApp (unit)', () => {
    const sub = makeSubscription({ subscriptionId: 'sub-1', name: 'Test Sub' });
    const subKey = AzureNodeId.from(sub).toString();

    function createCommand() {
        const { ctx, mock: mockResult } = createMockCodeContext();
        const output = new MockOutputChannel('test');

        // Provide workspace folder for HydrateAzdInfoStep + OfferSaveStep
        mockResult.workspaceFolders.push({
            uri: MockUri.file('/workspace'),
            name: 'workspace',
            index: 0,
        } as never);

        const dataTree = createMockDataItemTree([sub]);

        const viewItemTree = createMockViewItemTree({
            '': [subKey],
        });

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
        const execAzd = mock.fn((args: string[], cwd?: string) => {
            // Simulate `azd init` creating azure.yaml
            if (args[0] === 'init' && cwd) {
                mockFs.addFile(MockUri.file(`${cwd}/azure.yaml`), 'name: my-app');
            }
            return Promise.resolve({ stdout: '', stderr: '' });
        }) as unknown as IExecAzd;

        const cmd = new CreateFunctionApp(
            ctx,
            output,
            dataTree,
            viewItemTree as never,
            subscriptionClientProvider,
            tempManager,
            execAzd,
        );

        return { cmd, ctx, mockResult, fs: mockResult.fs, execAzd };
    }

    it('should be constructable with required dependencies', () => {
        const { cmd } = createCommand();
        expect(cmd).to.be.instanceOf(CreateFunctionApp);
    });

    it('should have an execute method', () => {
        const { cmd } = createCommand();
        expect(typeof cmd.execute).to.equal('function');
    });

    it('should run the full wizard flow and generate bicep files', async () => {
        const { cmd, mockResult, fs, execAzd } = createCommand();

        respondToPrompts(mockResult, [
            // ChooseSubscriptionStep: pick the subscription
            { pick: 'sub-1' },
            // ChooseLocationStep: pick a location
            { pick: 'East US' },
            // EnvironmentNameStep: enter environment name
            { input: 'my-env' },
            // PickRuntimeStep: pick a runtime
            { pick: 'Node.js' },
            // PickHostingPlanStep: pick a hosting plan
            { pick: 'Flex Consumption' },
            // OfferSaveStep: pick Deploy Only (uses temp dir, avoids workspace folder prompt)
            { pick: 'Deploy Only' },
        ]);

        await cmd.execute();

        // Verify GenerateBicepStep wrote the infra files
        expect(fs.createDirectory.mock.callCount()).to.be.greaterThanOrEqual(1);
        expect(fs.writeFile.mock.callCount()).to.be.greaterThanOrEqual(1);
        expect(fs.copy.mock.callCount()).to.be.greaterThanOrEqual(1);

        // Verify the parameters file content
        const writeArgs = fs.writeFile.mock.calls[0].arguments;
        const paramsContent = Buffer.from(writeArgs[1]).toString();
        const params = JSON.parse(paramsContent);
        expect(params.parameters.runtimeVersion.value).to.equal('Node|20');
        expect(params.parameters.hostingPlan.value).to.equal('FlexConsumption');

        // Verify execAzd was called for azd init and azd env new
        const execAzdMock = execAzd as unknown as ReturnType<typeof mock.fn>;
        expect(execAzdMock.mock.callCount()).to.be.greaterThanOrEqual(2);

        const calls = execAzdMock.mock.calls.map(c => c.arguments[0] as string[]);
        const initCall = calls.find(args => args[0] === 'init');
        expect(initCall).to.deep.equal(['init', '--minimal', '--no-prompt']);

        const envNewCall = calls.find(args => args[0] === 'env' && args[1] === 'new');
        expect(envNewCall).to.include('my-env');
        expect(envNewCall).to.include('--location');
        expect(envNewCall).to.include('eastus');
        expect(envNewCall).to.include('--subscription');
        expect(envNewCall).to.include('sub-1');
    });
});
