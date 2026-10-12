/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActionExecutor } from '@microsoft/vscode-azure-utils';
import { addMockExtension, createMockProcessExecutor, MockOutputChannel, NullTelemetryReporter } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { FunctionsProjectSelector } from '../../src/functions/FunctionsProjectSelector';
import { FunctionsDebugPreparation } from '../../src/functions/debug/FunctionsDebugPreparation';
import { FunctionsDebugProvider } from '../../src/functions/debug/FunctionsDebugProvider';
import { LocalFunctionsHostProcess } from '../../src/functions/host/LocalFunctionsHostProcess';
import { LocalFunctionsNetwork } from '../../src/functions/host/LocalFunctionsNetwork';
import type { IToolService } from '../../src/tools/ToolService';
import { createLocalFunctions } from '../tree/workspace/functions/mockLocalFunctions';

/** Shares real index, settings, validation, and host services with deterministic executable acquisition and network probes. */
export function createFunctionsDebugFixture(runtime = 'node', processOptions?: Parameters<typeof createMockProcessExecutor>[1]) {
    const s = createLocalFunctions();
    s.addProject(runtime);
    s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'local.settings.json'), JSON.stringify({
        IsEncrypted: false, Values: { ['FUNCTIONS_WORKER_RUNTIME']: runtime, ['AzureWebJobsStorage']: 'UseDevelopmentStorage=true' },
    }));
    if (runtime === 'native') {
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'go.mod'), 'module app\n\ngo 1.24\n');
        addMockExtension(s.m, 'golang.Go', {
            settings: { getExecutionCommand: mock.fn((tool: string) => ({ binPath: s.code.Uri.file(`/Go Tools/${tool}`).fsPath })) },
        });
    }
    const output = new MockOutputChannel('functions');
    const actions = new ActionExecutor(s.code, new NullTelemetryReporter(), 'test', output);
    const projects = new FunctionsProjectSelector(s.context.ctx, s.index, s.tree);
    const network = new LocalFunctionsNetwork();
    mock.method(network, 'listening', () => Promise.resolve(true));
    const { executor: processes, spawn } = createMockProcessExecutor(s.code, {
        keepAlive: runtime !== 'native',
        stdout: runtime === 'native' ? 'go version go1.24.1 windows/amd64\nDelve Debugger\nVersion: 1.24.0\n' : '',
        ...processOptions,
    });
    const tools = { acquire: mock.fn<IToolService['acquire']>(() => Promise.resolve({ executablePath: 'func' })), getResolvedPath: mock.fn(() => 'func') };
    const preparation = new FunctionsDebugPreparation(s.code, processes, tools, s.settings, projects, network);
    const owners = new LocalFunctionsHostProcess(s.code, processes, s.createHost, s.hosts, network, output);
    const provider = new FunctionsDebugProvider(s.code, actions, s.index, projects, preparation, owners, s.settings);
    return {
        ...s, projects, network, processes, spawn, tools, preparation, owners, debugProvider: provider,
        dispose: () => { provider.dispose(); owners.dispose(); s.dispose(); },
    };
}
