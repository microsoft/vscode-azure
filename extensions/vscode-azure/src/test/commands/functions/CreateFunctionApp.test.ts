/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ISubscriptionClientProvider } from '@microsoft/vscode-azure-azutils';
import { createMockDataItemTree, createMockViewItemTree, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, DebugOutputChannel, MockUri, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import { CreateFunctionApp } from '../../../commands/functions/CreateFunctionApp';
import { TempProjectManager } from '../../../wizard/azd/TempProjectManager';

describe('CreateFunctionApp (unit)', () => {
    const sub = makeSubscription({ subscriptionId: 'sub-1', name: 'Test Sub' });
    const subKey = AzureNodeId.from(sub).toString();

    function createCommand() {
        const { ctx, mock: mockResult } = createMockCodeContext();
        const output = new DebugOutputChannel('test');

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

        const cmd = new CreateFunctionApp(
            ctx,
            output,
            dataTree,
            viewItemTree as never,
            subscriptionClientProvider,
            tempManager,
        );

        return { cmd, ctx, mockResult, fs: mockResult.fs };
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
        const { cmd, mockResult, fs } = createCommand();

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

        // Execute will generate bicep + try to run azd init (which will throw ENOENT).
        // GenerateBicepStep should succeed (writes to MockFileSystem).
        // GenerateAzureYamlStep calls execAzd which throws ENOENT and propagates.
        try {
            await cmd.execute();
        } catch (e) {
            // Expected: azd CLI not installed
            expect((e as Error).message).to.include('Azure Developer CLI (azd) was not found');
        }

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
    });
});
