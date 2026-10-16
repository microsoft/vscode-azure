/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, MockUri, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { Wizard } from '@microsoft/vscode-azure-utils';
import { MockOutputChannel } from '@microsoft/vscode-azure-utils/testing';
import type { CreateFunctionAppContext } from '../../../src/commands/functions/CreateFunctionAppContext';
import { DetectFunctionRuntimeStep } from '../../../src/commands/functions/steps/DetectFunctionRuntimeStep';
import { PickRuntimeStep } from '../../../src/commands/functions/steps/PickRuntimeStep';
import { LocalFunctionSettings } from '../../../src/functions/LocalFunctionSettings';

describe('DetectFunctionRuntimeStep (unit)', () => {
    it('resolves the selected nested service path and prompts for its runtime version', async () => {
        const { ctx, mock } = createMockCodeContext();
        const root = MockUri.file('/workspace');
        mock.fs.addDirectory(MockUri.file('/workspace/api'));
        mock.fs.addFile(MockUri.file('/workspace/api/local.settings.json'), '{"Values":{"FUNCTIONS_WORKER_RUNTIME":"node"}}');
        respondToPrompts(mock, [{ pick: '24' }]);
        const wizard = new Wizard<CreateFunctionAppContext>(new MockOutputChannel('test'), {
            job: 'deploy', resourceDisplayName: 'Function App', iacFolder: root, hydratedServiceProjectPath: './api',
        }, [
            new DetectFunctionRuntimeStep(ctx, new LocalFunctionSettings(ctx.code)),
            new PickRuntimeStep(ctx),
        ], []);
        const result = await wizard.run();
        expect(result.functionWorkerRuntime).to.equal('node');
        expect(result.runtimeVersion).to.equal('24');
    });

    it('leaves unsupported worker settings to the runtime picker', async () => {
        const { ctx, mock } = createMockCodeContext();
        mock.fs.addFile(MockUri.file('/workspace/local.settings.json'), '{"Values":{"FUNCTIONS_WORKER_RUNTIME":"unsupported"}}');
        const step = new DetectFunctionRuntimeStep(ctx, new LocalFunctionSettings(ctx.code));
        expect(await step.prompt({ job: 'deploy', resourceDisplayName: 'Function App', iacFolder: MockUri.file('/workspace') })).to.deep.equal({});
    });

    it('prompts for a provisioning stack and version for a custom-handler project', async () => {
        const { ctx, mock } = createMockCodeContext();
        const root = MockUri.file('/workspace');
        mock.fs.addFile(MockUri.file('/workspace/local.settings.json'), '{"Values":{"FUNCTIONS_WORKER_RUNTIME":"custom"}}');
        respondToPrompts(mock, [{ pick: 'Python' }]);
        const wizard = new Wizard<CreateFunctionAppContext>(new MockOutputChannel('test'), {
            job: 'deploy', resourceDisplayName: 'Function App', iacFolder: root,
        }, [
            new DetectFunctionRuntimeStep(ctx, new LocalFunctionSettings(ctx.code)),
            new PickRuntimeStep(ctx),
        ], []);

        const result = await wizard.run();

        expect(result.functionWorkerRuntime).to.equal('python');
        expect(result.runtimeVersion).to.equal('3.12');
    });
});
