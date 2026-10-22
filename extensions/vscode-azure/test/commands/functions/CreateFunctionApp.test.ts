/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import { createMockDataItemTree, createMockSubscriptionClientProvider, createMockViewItemTree, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, MockOutputChannel, MockUri, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { TempDirManager } from '../../../src/azd/TempDirManager';
import { CreateFunctionApp } from '../../../src/commands/functions/CreateFunctionApp';
import { runtimeVersions } from '../../../src/commands/functions/steps/runtimesAndVersions';
import { createMockAzdService } from '../../azd/MockAzdService';
import { createWizardCommandContainer } from '../createWizardCommandContainer';
import { createMockArmProvider, createMockCodeProvider } from '../../tree/activity/MockActivityProviders';

describe('CreateFunctionApp (unit)', () => {
    const sub = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Test Sub' });
    const subKey = AzureNodeId.from(sub).toString();

    function createCommand(options: { workspaceFolder?: boolean } = {}) {
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
        });
        const cmd = container.get(CreateFunctionApp);

        return { cmd, ctx, mockResult, fs: mockResult.fs, azd, dataTree };
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

        await cmd.execute();

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

    it('should invalidate the data tree after execution', async () => {
        const { cmd, mockResult, dataTree } = createCommand();

        respondToPrompts(mockResult, [
            { pick: 'sub-1' },
            { pick: 'East US' },
            { input: 'my-app' },
            { pick: 'Node.js' },
            { pick: runtimeVersions.node[0] },
        ]);

        await cmd.execute();

        const invalidate = (dataTree as unknown as { invalidate: ReturnType<typeof mock.fn> }).invalidate;
        expect(invalidate.mock.callCount()).to.equal(1);
        const target = invalidate.mock.calls[0].arguments[0] as (node: unknown) => string | undefined;
        expect(target).to.be.a('function');
        expect(target(sub)).to.equal('subtree');
        expect(target(makeSubscription({ subscriptionId: 'other', displayName: 'Other' }))).to.be.undefined;
    });
});
