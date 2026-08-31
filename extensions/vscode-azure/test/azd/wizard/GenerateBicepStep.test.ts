/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, MockUri } from '@microsoft/vscode-azure-utils/testing';
import type * as vscode from 'vscode';
import type { AzdWizardContext } from '../../../src/azd/wizard/AzdWizardContext';
import { GenerateBicepStep } from '../../../src/azd/wizard/GenerateBicepStep';

interface TestBicepContext extends AzdWizardContext {
    readonly functionWorkerRuntime?: string;
    readonly runtimeVersion?: string;
    readonly appServicePlanSkuName?: string;
}

describe('GenerateBicepStep (unit)', () => {
    function createCtxWithFs(existingFiles: vscode.Uri[] = []) {
        const { ctx, mock: mockResult } = createMockCodeContext();
        for (const uri of existingFiles) {
            mockResult.fs.addFile(uri);
        }
        return { ctx, fs: mockResult.fs };
    }

    describe('shouldExecute', () => {
        it('should return false when iacFolder is not set', async () => {
            const { ctx } = createCtxWithFs();
            const step = new GenerateBicepStep<TestBicepContext>(ctx, 'functionApp', ['functionWorkerRuntime']);

            expect(await step.shouldExecute({})).to.be.false;
        });

        it('should return true when infra files do not exist', async () => {
            const { ctx } = createCtxWithFs();
            const step = new GenerateBicepStep<TestBicepContext>(ctx, 'functionApp', ['functionWorkerRuntime']);

            const context = { iacFolder: MockUri.file('/project') } as TestBicepContext;
            expect(await step.shouldExecute(context)).to.be.true;
        });

        it('should return false when main.bicep already exists', async () => {
            const { ctx } = createCtxWithFs([MockUri.file('/project/infra/main.bicep')]);
            const step = new GenerateBicepStep<TestBicepContext>(ctx, 'functionApp', ['functionWorkerRuntime']);

            const context = { iacFolder: MockUri.file('/project') } as TestBicepContext;
            expect(await step.shouldExecute(context)).to.be.false;
        });

        it('should return false when main.parameters.json already exists', async () => {
            const { ctx } = createCtxWithFs([MockUri.file('/project/infra/main.parameters.json')]);
            const step = new GenerateBicepStep<TestBicepContext>(ctx, 'functionApp', ['functionWorkerRuntime']);

            const context = { iacFolder: MockUri.file('/project') } as TestBicepContext;
            expect(await step.shouldExecute(context)).to.be.false;
        });

        it('should return false when the infra directory already exists', async () => {
            const { ctx, fs } = createCtxWithFs();
            fs.addDirectory(MockUri.file('/project/infra'));
            const step = new GenerateBicepStep<TestBicepContext>(ctx, 'functionApp', ['functionWorkerRuntime']);

            const context = { iacFolder: MockUri.file('/project') } as TestBicepContext;
            expect(await step.shouldExecute(context)).to.be.false;
        });
    });

    describe('execute', () => {
        it('should create infra directory and write files', async () => {
            const { ctx, fs } = createCtxWithFs();
            const step = new GenerateBicepStep<TestBicepContext>(ctx, 'functionApp', ['functionWorkerRuntime', 'runtimeVersion', 'appServicePlanSkuName']);

            const context = {
                iacFolder: MockUri.file('/project'),
                functionWorkerRuntime: 'node',
                runtimeVersion: '20',
                appServicePlanSkuName: 'FC1',
            } as TestBicepContext;

            await step.execute(context);

            expect(fs.writeFile.mock.callCount()).to.equal(1);
            expect(fs.copy.mock.callCount()).to.equal(1);

            const paramsContent = Buffer.from(fs.writeFile.mock.calls[0].arguments[1]).toString();
            const params = JSON.parse(paramsContent);
            // eslint-disable-next-line no-template-curly-in-string -- azd placeholders
            expect(params.parameters.environmentName.value).to.equal('${AZURE_ENV_NAME}');
            // eslint-disable-next-line no-template-curly-in-string -- azd placeholders
            expect(params.parameters.location.value).to.equal('${AZURE_LOCATION}');
            expect(params.parameters.functionWorkerRuntime.value).to.equal('node');
            expect(params.parameters.runtimeVersion.value).to.equal('20');
            expect(params.parameters.appServicePlanSkuName.value).to.equal('FC1');

            const paramsUri = fs.writeFile.mock.calls[0].arguments[0];
            expect(paramsUri.path).to.equal('/project/infra/main.parameters.json');
        });

        it('should omit undefined parameter keys', async () => {
            const { ctx, fs } = createCtxWithFs();
            const step = new GenerateBicepStep<TestBicepContext>(ctx, 'functionApp', ['functionWorkerRuntime', 'runtimeVersion', 'appServicePlanSkuName']);

            const context = {
                iacFolder: MockUri.file('/project'),
                functionWorkerRuntime: 'node',
            } as TestBicepContext;

            await step.execute(context);

            const paramsContent = Buffer.from(fs.writeFile.mock.calls[0].arguments[1]).toString();
            const params = JSON.parse(paramsContent);
            expect(params.parameters.functionWorkerRuntime.value).to.equal('node');
            expect(params.parameters).to.not.have.property('appServicePlanSkuName');
        });

        it('should copy the whole template directory into infra', async () => {
            const { ctx, fs } = createCtxWithFs();
            const step = new GenerateBicepStep<TestBicepContext>(ctx, 'functionApp', []);

            const context = {
                iacFolder: MockUri.file('/project'),
            } as TestBicepContext;

            await step.execute(context);

            // Copying the directory rather than a single file is what lets a
            // template ship a `modules/` subtree whose relative paths survive.
            const sourceUri = fs.copy.mock.calls[0].arguments[0];
            expect(sourceUri.path).to.include('resources/templates/functionApp');
            expect(sourceUri.path).to.not.include('main.bicep');

            const destUri = fs.copy.mock.calls[0].arguments[1];
            expect(destUri.path).to.equal('/project/infra');
        });

        it('should reject generation when the infra directory already exists', async () => {
            const { ctx, fs } = createCtxWithFs();
            fs.addDirectory(MockUri.file('/project/infra'));
            const step = new GenerateBicepStep<TestBicepContext>(ctx, 'functionApp', []);
            const context = { iacFolder: MockUri.file('/project') } as TestBicepContext;

            await expect(step.execute(context)).to.be.rejectedWith('Cannot generate infrastructure because the infra folder already exists.');
            expect(fs.copy.mock.callCount()).to.equal(0);
            expect(fs.writeFile.mock.callCount()).to.equal(0);
        });
    });
});
