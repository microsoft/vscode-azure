/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type { AzureYamlEditor } from '../../../src/azd/AzdService';
import { ConfigureFunctionAppServiceStep } from '../../../src/commands/functions/steps/ConfigureFunctionAppServiceStep';
import type { CreateFunctionAppContext, FunctionWorkerRuntime } from '../../../src/commands/functions/CreateFunctionAppContext';
import { createMockAzdService } from '../../azd/MockAzdService';

describe('ConfigureFunctionAppServiceStep (unit)', () => {
    const ready: CreateFunctionAppContext = {
        resourceDisplayName: 'Function App', job: 'deploy', iacFolder: MockUri.file('/project'),
        azdServiceName: 'api', functionWorkerRuntime: 'node',
    };

    for (const [runtime, language] of [
        ['node', 'js'], ['python', 'python'], ['dotnet-isolated', 'dotnet'], ['java', 'java'], ['powershell', 'ps'],
    ] satisfies [FunctionWorkerRuntime, string][]) {
        it(`configures an azd-deployable ${runtime} Functions service`, async () => {
            const azd = createMockAzdService();
            const { vscode } = createMockVsCode();
            const set = mock.fn<AzureYamlEditor['set']>();
            azd.updateAzureYaml.mock.mockImplementation(async (_cwd, updater) => { // eslint-disable-line @typescript-eslint/no-deprecated -- temporary azd compatibility API
                await updater({ set });
            });
            const step = new ConfigureFunctionAppServiceStep(azd, vscode);
            expect(step.shouldExecute(ready)).to.be.true;
            await step.execute({ ...ready, functionWorkerRuntime: runtime });
            expect(set.mock.calls[0].arguments).to.deep.equal([
                ['services', 'api'], { host: 'function', project: '.', language },
            ]);
        });
    }

    it('preserves existing services and keeps empty-resource creation infrastructure-only', () => {
        const { vscode } = createMockVsCode();
        const step = new ConfigureFunctionAppServiceStep(createMockAzdService(), vscode);
        expect(step.shouldExecute({ ...ready, hasServices: true })).to.be.false;
        expect(step.shouldExecute({ ...ready, job: 'createNew' })).to.be.false;
    });

    it('requires a runtime before editing deployment configuration', async () => {
        const { vscode } = createMockVsCode();
        const azd = createMockAzdService();
        const step = new ConfigureFunctionAppServiceStep(azd, vscode);
        await expect(step.execute({ ...ready, functionWorkerRuntime: undefined })).to.be.rejectedWith('Select a Functions runtime');
        expect(azd.updateAzureYaml.mock.callCount()).to.equal(0); // eslint-disable-line @typescript-eslint/no-deprecated -- temporary azd compatibility API
    });
});
