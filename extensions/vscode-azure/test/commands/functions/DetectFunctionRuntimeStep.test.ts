/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, MockUri, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { Wizard } from '@microsoft/vscode-azure-utils';
import { MockOutputChannel } from '@microsoft/vscode-azure-utils/testing';
import { mock as nodeMock } from 'node:test';
import type { CreateFunctionAppContext } from '../../../src/commands/functions/CreateFunctionAppContext';
import { DetectFunctionRuntimeStep } from '../../../src/commands/functions/steps/DetectFunctionRuntimeStep';
import { PickRuntimeStep } from '../../../src/commands/functions/steps/PickRuntimeStep';
import { LocalFunctionSettings } from '../../../src/functions/LocalFunctionSettings';

describe('DetectFunctionRuntimeStep (unit)', () => {
    afterEach(() => { nodeMock.restoreAll(); });

    for (const projectPath of ['./api', './api/host.json']) {
        it(`resolves the selected nested service path ${projectPath} and prompts for its runtime version`, async () => {
            const { ctx, mock } = createMockCodeContext();
            const root = MockUri.file('/workspace');
            mock.fs.addDirectory(MockUri.file('/workspace/api'));
            mock.fs.addFile(MockUri.file('/workspace/api/host.json'), '{}');
            mock.fs.addFile(MockUri.file('/workspace/api/local.settings.json'), '{"Values":{"FUNCTIONS_WORKER_RUNTIME":"node"}}');
            respondToPrompts(mock, [{ pick: '24' }]);
            const output = new MockOutputChannel('test');
            const wizard = new Wizard<CreateFunctionAppContext>(output, {
                job: 'deploy', resourceDisplayName: 'Function App', iacFolder: root, hydratedServiceProjectPath: projectPath,
            }, [
                new DetectFunctionRuntimeStep(ctx, new LocalFunctionSettings(ctx.code), output),
                new PickRuntimeStep(ctx),
            ], []);
            const result = await wizard.run();
            expect(result.functionWorkerRuntime).to.equal('node');
            expect(result.runtimeVersion).to.equal('24');
        });
    }

    for (const { name, settings } of [
        { name: 'encrypted', settings: '{"IsEncrypted":true,"Values":{"FUNCTIONS_WORKER_RUNTIME":"node"}}' },
        { name: 'malformed', settings: '{"Values":' },
        { name: 'duplicate properties', settings: '{"Values":{"FUNCTIONS_WORKER_RUNTIME":"node","FUNCTIONS_WORKER_RUNTIME":"python"}}' },
    ]) {
        it(`offers runtime selection when local settings are ${name}`, async () => {
            const { ctx, mock } = createMockCodeContext();
            mock.fs.addFile(MockUri.file('/workspace/local.settings.json'), settings);
            const responses = respondToPrompts(mock, [{ pick: 'Python' }]);
            const output = new MockOutputChannel('test');
            const warning = nodeMock.method(output, 'warn');
            const wizard = new Wizard<CreateFunctionAppContext>(output, {
                job: 'deploy', resourceDisplayName: 'Function App', iacFolder: MockUri.file('/workspace'),
            }, [
                new DetectFunctionRuntimeStep(ctx, new LocalFunctionSettings(ctx.code), output),
                new PickRuntimeStep(ctx),
            ], []);

            const result = await wizard.run();

            expect(result.functionWorkerRuntime).to.equal('python');
            expect(result.runtimeVersion).to.equal('3.12');
            expect(warning.mock.callCount()).to.equal(1);
            expect(warning.mock.calls[0].arguments).to.deep.equal([
                '[functions] Could not detect the project runtime. Select a runtime to continue.',
            ]);
            responses.assertAllConsumed();
        });
    }

    it('leaves an unavailable project path to the runtime picker', async () => {
        const { ctx } = createMockCodeContext();
        const output = new MockOutputChannel('test');
        const warning = nodeMock.method(output, 'warn');
        const step = new DetectFunctionRuntimeStep(ctx, new LocalFunctionSettings(ctx.code), output);
        expect(await step.prompt({
            job: 'deploy', resourceDisplayName: 'Function App', iacFolder: MockUri.file('/workspace'), hydratedServiceProjectPath: './missing',
        })).to.deep.equal({});
        expect(warning.mock.callCount()).to.equal(1);
        expect(warning.mock.calls[0].arguments).to.deep.equal([
            '[functions] Could not detect the project runtime. Select a runtime to continue.',
        ]);
    });

    it('leaves unsupported worker settings to the runtime picker', async () => {
        const { ctx, mock } = createMockCodeContext();
        mock.fs.addFile(MockUri.file('/workspace/local.settings.json'), '{"Values":{"FUNCTIONS_WORKER_RUNTIME":"unsupported"}}');
        const step = new DetectFunctionRuntimeStep(ctx, new LocalFunctionSettings(ctx.code), new MockOutputChannel('test'));
        expect(await step.prompt({ job: 'deploy', resourceDisplayName: 'Function App', iacFolder: MockUri.file('/workspace') })).to.deep.equal({});
    });

    it('prompts for a provisioning stack and version for a custom-handler project', async () => {
        const { ctx, mock } = createMockCodeContext();
        const root = MockUri.file('/workspace');
        mock.fs.addFile(MockUri.file('/workspace/local.settings.json'), '{"Values":{"FUNCTIONS_WORKER_RUNTIME":"custom"}}');
        respondToPrompts(mock, [{ pick: 'Python' }]);
        const output = new MockOutputChannel('test');
        const wizard = new Wizard<CreateFunctionAppContext>(output, {
            job: 'deploy', resourceDisplayName: 'Function App', iacFolder: root,
        }, [
            new DetectFunctionRuntimeStep(ctx, new LocalFunctionSettings(ctx.code), output),
            new PickRuntimeStep(ctx),
        ], []);

        const result = await wizard.run();

        expect(result.functionWorkerRuntime).to.equal('python');
        expect(result.runtimeVersion).to.equal('3.12');
    });
});
