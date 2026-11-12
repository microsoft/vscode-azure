/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActionExecutor, type IVsCode } from '@microsoft/vscode-azure-utils';
import { addMockExtension, createMockProcessExecutor, MockOutputChannel, NullTelemetryReporter } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { FunctionsDebugPreparation } from '../../src/functions/debug/FunctionsDebugPreparation';
import { FunctionsDebugProvider } from '../../src/functions/debug/FunctionsDebugProvider';
import { OwnedFunctionsHostSession } from '../../src/functions/host/OwnedFunctionsHostSession';
import { LocalFunctionsHostProcess } from '../../src/functions/host/LocalFunctionsHostProcess';
import { LocalFunctionsNetwork } from '../../src/functions/host/LocalFunctionsNetwork';
import type { IToolService } from '../../src/tools/ToolService';
import { createLocalFunctions } from '../tree/workspace/functions/mockLocalFunctions';

/** Stubs port ownership without binding sockets; real socket behavior has separate coverage. */
export function createMockFunctionsNetwork(code: IVsCode) {
    const network = new LocalFunctionsNetwork(code);
    let nextPort = 17000;
    const reserve = mock.fn((port?: number) => Promise.resolve({
        port: port ?? nextPort++,
        release: mock.fn(() => Promise.resolve()),
    }));
    mock.method(network, 'reserve', reserve);
    mock.method(network, 'listening', () => Promise.resolve(true));
    return { network, reserve };
}

/** Supplies the Python extension's selected interpreter and resource-scoped environment. */
export function selectPythonEnvironment(
    s: ReturnType<typeof createLocalFunctions>,
    executable: vscode.Uri,
    variables: Readonly<Record<string, string>> = {},
) {
    const environments = {
        getActiveEnvironmentPath: mock.fn(() => ({ path: executable.fsPath })),
        resolveEnvironment: mock.fn(() => Promise.resolve({ executable: { uri: executable } })),
        getEnvironmentVariables: mock.fn(() => Promise.resolve(variables)),
    };
    addMockExtension(s.m, 'ms-python.python', {
        ready: Promise.resolve(), environments,
    });
    return environments;
}

/** Shares real index, settings, validation, and host services with deterministic executable acquisition and network probes. */
export function createFunctionsDebugFixture(runtime = 'node', processOptions?: Parameters<typeof createMockProcessExecutor>[1]) {
    const s = createLocalFunctions();
    s.addProject(runtime);
    s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'local.settings.json'), JSON.stringify({
        IsEncrypted: false, Values: { ['FUNCTIONS_WORKER_RUNTIME']: runtime, ['AzureWebJobsStorage']: 'UseDevelopmentStorage=true' },
    }));
    if (runtime === 'node') {
        addMockExtension(s.m, 'ms-vscode.js-debug', {});
    }
    if (runtime === 'native') {
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'go.mod'), 'module app\n\ngo 1.24\n');
        addMockExtension(s.m, 'golang.Go', {
            settings: { getExecutionCommand: mock.fn((tool: string) => ({ binPath: s.code.Uri.file(`/Go Tools/${tool}`).fsPath })) },
        });
    }
    if (runtime === 'python') {
        const executable = s.code.Uri.joinPath(s.folder, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, '.venv', 'pyvenv.cfg'), '');
        selectPythonEnvironment(s, executable);
    }
    const output = new MockOutputChannel('functions');
    const actions = new ActionExecutor(s.code, new NullTelemetryReporter(), 'test', output);
    const projects = s.projects;
    const { network } = createMockFunctionsNetwork(s.code);
    const { executor: processes, spawn } = createMockProcessExecutor(s.code, {
        keepAlive: runtime !== 'native',
        stdout: runtime === 'native' ? 'go version go1.24.1 windows/amd64\nDelve Debugger\nVersion: 1.24.0\n' : '',
        ...processOptions,
    });
    const tools = { acquire: mock.fn<IToolService['acquire']>(() => Promise.resolve({ executablePath: 'func' })), getResolvedPath: mock.fn(() => 'func') };
    const preparation = new FunctionsDebugPreparation(s.context.ctx, processes, tools, s.settings, projects);
    // The mock host process never exits, so the real workload check would wait forever; its tests restore it.
    const ensureWorkloads = mock.method(preparation, 'ensureWorkloads', () => Promise.resolve());
    const owners = new LocalFunctionsHostProcess(s.code, () => new OwnedFunctionsHostSession(s.code, processes, s.createHost, s.hosts, network, output), network, output);
    const provider = new FunctionsDebugProvider(s.code, actions, s.index, projects, preparation, owners);
    // The provider hands the language debugger's attach configuration to startDebugging; resolving here yields that
    // configuration, or undefined when no debugger session was started.
    const debugProvider = {
        register: () => { provider.register(); },
        provideDebugConfigurations: (folder?: vscode.WorkspaceFolder) => provider.provideDebugConfigurations(folder),
        resolveDebugConfiguration: (folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration) => provider.resolveDebugConfiguration(folder, config),
        resolveDebugConfigurationWithSubstitutedVariables: async (folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken) => {
            const startDebugging = s.m.debug.startDebugging.mock;
            const before = startDebugging.callCount();
            await provider.resolveDebugConfigurationWithSubstitutedVariables(folder, config, token);
            return startDebugging.callCount() > before ? startDebugging.calls[before].arguments[1] as vscode.DebugConfiguration : undefined;
        },
    };
    return {
        ...s, projects, network, processes, spawn, tools, preparation, ensureWorkloads, owners, functionsDebugProvider: provider, debugProvider,
        dispose: () => { provider.dispose(); owners.dispose(); s.dispose(); },
    };
}
