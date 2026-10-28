/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExternalError } from '@microsoft/vscode-azure-utils';
import { addMockExtension, addWorkspaceFolder, MockCancellationToken, respondToPrompts, waitFor } from '@microsoft/vscode-azure-utils/testing';
import { delimiter } from 'node:path';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import type { FunctionsDebugLaunch } from '../../src/functions/debug/FunctionsDebugPreparation';
import type { FunctionsHostStart } from '../../src/functions/host/LocalFunctionsHostProcess';
import { createFunctionsDebugFixture, selectPythonEnvironment } from './mockFunctionsDebug';

describe('Functions debug provider (unit)', () => {
    const fixtures: ReturnType<typeof createFunctionsDebugFixture>[] = [];
    function setup(runtime = 'node') {
        const s = createFunctionsDebugFixture(runtime);
        fixtures.push(s);
        const config = { type: 'azure-functions', request: 'launch', name: 'Functions', projectPath: s.folder.fsPath, skipBuild: true };
        return { ...s, config };
    }
    afterEach(() => { fixtures.splice(0).forEach(s => { s.dispose(); }); mock.restoreAll(); });

    it('starts the hinted project even when another Functions project is present', async () => {
        const s = setup();
        const nested = s.code.Uri.joinPath(s.folder, 'nested');
        s.m.fs.addFile(s.code.Uri.joinPath(nested, 'host.json'), '{"version":"2.0"}');
        s.m.fs.addFile(s.code.Uri.joinPath(nested, 'local.settings.json'), JSON.stringify({
            Values: { ['FUNCTIONS_WORKER_RUNTIME']: 'node', ['AzureWebJobsStorage__accountName']: 'account' },
        }));
        const projects = await s.tree.getChildren();
        const project = projects.find(node => node.resourceUri?.toString() === s.code.Uri.joinPath(nested, 'host.json').toString());
        if (!project) { throw new Error('Expected nested Functions project'); }
        const [hint] = await s.tree.getChildren(project);
        const command = s.view.getTreeItem(hint.id).command;
        if (!command) { throw new Error('Expected a start-debugging command'); }
        const start = mock.method(s.owners, 'start', (request: FunctionsHostStart) => {
            expect(request.project.toString()).to.equal(nested.toString());
            return Promise.resolve({ id: 'owned', hostPort: 7072, debugPort: 9229, pipe: 'pipe' });
        });
        const registration = s.code.commands.registerCommand('debug.startFromConfig', async (config: vscode.DebugConfiguration) =>
            s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, config));
        try {
            const execute = s.m.registeredCommands.get(command.command);
            if (!execute) { throw new Error('Expected the VS Code debugger command'); }
            const result = await execute(...command.arguments ?? []);
            expect(result).to.have.property('type', 'pwa-node');
            expect(start.mock.callCount()).to.equal(1);
            expect(s.m.quickPicks).to.be.empty;
        } finally {
            registration.dispose();
        }
    });

    it('prompts during F5 when local settings are absent and uses the selected runtime in host startup', async () => {
        const s = setup();
        const uri = s.code.Uri.joinPath(s.folder, 'local.settings.json');
        await s.code.workspace.fs.delete(uri);
        const prompts = respondToPrompts(s.m, [{ pick: 'Node.js / TypeScript' }]);
        const start = mock.method(s.owners, 'start', async (request: FunctionsHostStart) => {
            expect(request.runtime).to.equal('node');
            const environment = await request.prepare(9229, 'pipe');
            expect(environment.FUNCTIONS_WORKER_RUNTIME).to.equal('node');
            expect(environment.AzureWebJobsStorage__accountName).to.equal('account');
            expect(environment.languageWorkers__node__arguments).to.equal('--inspect-brk=127.0.0.1:9229');
            return { id: 'owned', hostPort: 7072, debugPort: 9229, pipe: 'pipe' };
        });
        const config = await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
            ...s.config, env: { ['AzureWebJobsStorage__accountName']: 'account' },
        });
        prompts.assertAllConsumed();
        expect(config?.type).to.equal('pwa-node');
        expect(start.mock.callCount()).to.equal(1);
        expect(s.m.fs.writeFile.mock.callCount()).to.equal(1);
        expect((await s.settings.read(s.folder)).values.get('FUNCTIONS_WORKER_RUNTIME')).to.equal('node');
        expect((await s.settings.read(s.folder)).values.get('AzureWebJobsStorage__accountName')).to.be.undefined;
    });

    it('runs the Node attach past the inspector entry pause', async () => {
        const s = setup();
        mock.method(s.owners, 'start', () => Promise.resolve({ id: 'owned', hostPort: 7072, debugPort: 9229, pipe: 'pipe' }));
        const config = await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, s.config);
        expect(config).to.include({ type: 'pwa-node', request: 'attach', port: 9229, continueOnAttach: true });
    });

    it('starts the language debugger as its own session and ends the Functions session without a configuration', async () => {
        const s = setup();
        mock.method(s.owners, 'start', () => Promise.resolve({ id: 'owned', hostPort: 7072, debugPort: 9229, pipe: 'pipe' }));
        const config = { ...s.config, postDebugTask: 'cleanup' };
        const resolved = await s.functionsDebugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, config);
        expect(resolved).to.be.undefined;
        const [[folder, attach]] = s.m.debug.startDebugging.mock.calls.map(call => call.arguments);
        expect(folder).to.equal(s.code.workspace.getWorkspaceFolder(s.folder));
        expect(attach).to.include({ type: 'pwa-node', request: 'attach', ['__azureFunctionsHostId']: 'owned', postDebugTask: 'cleanup' });
    });

    it('stops the host and reports an error when the language debugger session does not start', async () => {
        const s = setup();
        mock.method(s.owners, 'start', () => Promise.resolve({ id: 'owned', hostPort: 7072, debugPort: 9229, pipe: 'pipe' }));
        const stop = mock.method(s.owners, 'stop', () => Promise.resolve());
        s.m.debug.startDebugging.mock.mockImplementation(() => Promise.resolve(false));
        expect(await s.functionsDebugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, s.config)).to.be.undefined;
        expect(stop.mock.calls.map(call => call.arguments[0])).to.deep.equal(['owned']);
        expect(s.m.window.showErrorMessage.mock.calls.at(-1)?.arguments[0]).to.include('Could not start the language debugger');
    });

    it('dismisses runtime selection without acquiring tools or starting a host', async () => {
        const s = setup('');
        const prompts = respondToPrompts(s.m, ['cancel']);
        expect(await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, s.config)).to.be.undefined;
        prompts.assertAllConsumed();
        expect(s.tools.acquire.mock.callCount()).to.equal(0);
        expect(s.spawn.mock.callCount()).to.equal(0);
        expect(s.m.tasks.executeTask.mock.callCount()).to.equal(0);
        expect(s.m.fs.writeFile.mock.callCount()).to.equal(0);
    });

    it('reports a failed runtime-settings write without acquiring tools or starting a host', async () => {
        const s = setup('');
        const prompts = respondToPrompts(s.m, [{ pick: 'Node.js / TypeScript' }]);
        mock.method(s.code.workspace.fs, 'writeFile', () => Promise.reject(new Error('Settings write denied')));
        expect(await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, s.config)).to.be.undefined;
        prompts.assertAllConsumed();
        expect(s.tools.acquire.mock.callCount()).to.equal(0);
        expect(s.spawn.mock.callCount()).to.equal(0);
        expect(s.m.tasks.executeTask.mock.callCount()).to.equal(0);
        expect(s.m.window.showErrorMessage.mock.calls.at(-1)?.arguments[0]).to.include('Settings write denied');
    });

    it('applies launch and owned worker settings without duplicating mixed-case local keys', async () => {
        const s = setup();
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'local.settings.json'), JSON.stringify({
            Values: {
                ['functions_worker_runtime']: 'unsupported',
                ['functions_worker_process_count']: '4',
                ['azurewebjobsstorage__accountname']: 'storage-account',
                ['languageworkers__node__arguments']: 'unowned',
                ['custom_setting']: 'local',
            },
        }));
        const start = mock.method(s.owners, 'start', async (request: FunctionsHostStart) => {
            const env = await request.prepare(9229, 'owned-pipe');
            expect(env).to.deep.equal({
                ['azurewebjobsstorage__accountname']: 'storage-account',
                ['CUSTOM_SETTING']: 'launch',
                ['languageWorkers__node__arguments']: '--inspect-brk=127.0.0.1:9229',
                ['FUNCTIONS_WORKER_RUNTIME']: 'node',
                ['FUNCTIONS_WORKER_PROCESS_COUNT']: '1',
            });
            return { id: 'owned', hostPort: 7072, debugPort: 9229, pipe: 'owned-pipe' };
        });

        const config = await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
            ...s.config, env: { ['FUNCTIONS_WORKER_RUNTIME']: 'node', ['CUSTOM_SETTING']: 'launch' },
        });

        expect(config?.type).to.equal('pwa-node');
        expect(start.mock.callCount()).to.equal(1);
    });

    it('discovers nested projects and resolves initial configurations without tool acquisition or a process', async () => {
        const s = setup();
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'nested', 'host.json'), '{}');
        const configs = await s.debugProvider.provideDebugConfigurations();
        expect(configs.map((config): unknown => config.projectPath)).to.include(s.code.Uri.joinPath(s.folder, 'nested').fsPath);
        const path = `\${workspaceFolder}/nested`;
        const config = s.debugProvider.resolveDebugConfiguration(undefined, {
            type: 'azure-functions', request: 'launch', name: 'Functions', projectPath: path,
        });
        expect(config.projectPath).to.equal(path);
        expect(s.tools.acquire.mock.callCount()).to.equal(0);
        expect(s.spawn.mock.callCount()).to.equal(0);
    });

    it('keeps validated settings and Python selection consistent through startup and reads fresh settings for the next launch', async () => {
        const s = setup('python');
        const executable = s.code.Uri.joinPath(s.folder, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
        const python = selectPythonEnvironment(s, executable, { ['CUSTOM_SETTING']: 'python' });
        addMockExtension(s.m, 'ms-python.debugpy', {
            debug: {
                getRemoteLauncherCommand: () => Promise.resolve(['debugpy', '--listen', '127.0.0.1:9001']),
                getDebuggerPackagePath: () => Promise.resolve('/debugpy'),
            },
        });
        const read = mock.method(s.settings, 'read');
        const worker = mock.method(s.preparation, 'workerEnvironment');
        mock.method(s.tools, 'acquire', () => {
            s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'local.settings.json'), JSON.stringify({
                Values: { ['FUNCTIONS_WORKER_RUNTIME']: 'node', ['AzureWebJobsStorage__accountName']: 'updated' },
            }));
            s.m.installedExtensions.delete('ms-python.python');
            return Promise.resolve({ executablePath: 'func' });
        });
        mock.method(s.owners, 'start', async (request: FunctionsHostStart) => {
            await request.prepare(9001, 'owned-pipe');
            return { id: 'owned', hostPort: 7072, debugPort: 9001, pipe: 'owned-pipe' };
        });

        const first = await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
            ...s.config, env: { ['CUSTOM_SETTING']: 'launch' },
        });
        expect(first?.type).to.equal('debugpy');
        const environment = await worker.mock.calls[0].result;
        expect(environment?.languageWorkers__python__defaultExecutablePath).to.equal(executable.fsPath);
        expect(environment?.FUNCTIONS_WORKER_RUNTIME).to.equal('python');
        expect(environment?.AzureWebJobsStorage).to.equal('UseDevelopmentStorage=true');
        expect(environment?.CUSTOM_SETTING).to.equal('launch');
        expect(read.mock.callCount()).to.equal(1);
        expect(python.resolveEnvironment.mock.callCount()).to.equal(1);
        expect(python.getEnvironmentVariables.mock.callCount()).to.equal(1);

        addMockExtension(s.m, 'ms-vscode.js-debug', {});
        const second = await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, s.config);
        expect(second?.type).to.equal('pwa-node');
        const nextEnvironment = await worker.mock.calls[1].result;
        expect(nextEnvironment?.AzureWebJobsStorage__accountName).to.equal('updated');
        expect(nextEnvironment?.AzureWebJobsStorage).to.be.undefined;
        expect(read.mock.callCount()).to.equal(2);
    });

    for (const [runtime, type] of [['node', 'pwa-node'], ['python', 'debugpy'], ['java', 'java'], ['powershell', 'PowerShell'], ['dotnet-isolated', 'coreclr'], ['native', 'go']]) {
        it(`returns ${runtime} attach coordinates owned by the selected project`, async () => {
            const s = setup(runtime);
            mock.method(s.preparation, 'workerEnvironment', (launch: FunctionsDebugLaunch) => Promise.resolve({
                ...launch.environment,
                ['FUNCTIONS_WORKER_RUNTIME']: launch.runtime,
                ['FUNCTIONS_WORKER_PROCESS_COUNT']: '1',
            }));
            const start = mock.method(s.owners, 'start', async (request: FunctionsHostStart) => {
                const env = await request.prepare(9229, 'owned-pipe');
                expect(env.FUNCTIONS_WORKER_RUNTIME).to.equal(runtime);
                expect(env.FUNCTIONS_WORKER_PROCESS_COUNT).to.equal('1');
                return { id: 'owned', hostPort: 7072, debugPort: 9229, pipe: 'owned-pipe', workerPid: 1234 };
            });
            const presentation = { group: 'functions', order: 1 };
            const config = await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
                ...s.config, postDebugTask: 'cleanup', presentation, internalConsoleOptions: 'neverOpen',
            });
            expect(config?.type).to.equal(type);
            expect(config?.request).to.equal('attach');
            expect(config?.__azureFunctionsHostId).to.equal('owned');
            expect(config?.preLaunchTask).to.be.undefined;
            expect(config?.postDebugTask).to.equal('cleanup');
            expect(config?.presentation).to.deep.equal(presentation);
            expect(config?.internalConsoleOptions).to.equal('neverOpen');
            expect(s.tools.acquire.mock.calls[0].arguments[0].versionRange).to.equal('>=5.0.0-preview.3');
            expect(start.mock.calls[0].arguments[0].project.toString()).to.equal(s.folder.toString());
            if (runtime === 'node' || runtime === 'java') { expect(config?.port).to.equal(9229); }
            if (runtime === 'python') { expect(config?.connect).to.deep.equal({ host: '127.0.0.1', port: 9229 }); }
            if (runtime === 'powershell') { expect(config?.customPipeName).to.equal('owned-pipe'); }
            if (runtime === 'dotnet-isolated') { expect(config?.processId).to.equal('1234'); }
            if (runtime === 'native') {
                expect(config?.mode).to.equal('remote');
                expect(config?.debugAdapter).to.equal('dlv-dap');
                expect(config?.host).to.equal('127.0.0.1');
                expect(config?.port).to.equal(9229);
                expect(config?.cwd).to.equal(s.folder.fsPath);
                expect(start.mock.calls[0].arguments[0].runtime).to.equal('native');
            }
        });
    }

    for (const [platform, pathName, expectedPath] of [
        ['win32', 'Path', 'launch-path'], ['win32', 'pAtH', 'launch-path'],
        ['linux', 'PATH', 'launch-path'], ['linux', 'Path', 'environment-path'],
    ] as const) {
        it(`uses the selected Python interpreter, quoted debugger path, and ${platform} ${pathName} precedence`, async () => {
            mock.property(process, 'platform', platform);
            const s = setup('python');
            const virtualEnvironment = s.code.Uri.file('/Selected Python Environment');
            const executableDirectory = s.code.Uri.joinPath(virtualEnvironment, platform === 'win32' ? 'Scripts' : 'bin');
            const python = s.code.Uri.joinPath(executableDirectory, platform === 'win32' ? 'python.exe' : 'python');
            s.m.fs.addFile(s.code.Uri.joinPath(virtualEnvironment, 'pyvenv.cfg'), '');
            selectPythonEnvironment(s, python, {
                ['CUSTOM_PYTHON_ENV']: 'configured', ['PATH']: 'environment-path',
            });
            const launcher = mock.fn(() => Promise.resolve(['"C:\\Python Debugger\\debugpy"', '--listen', '127.0.0.1:9001', '--wait-for-client']));
            addMockExtension(s.m, 'ms-python.debugpy', {
                debug: { getRemoteLauncherCommand: launcher, getDebuggerPackagePath: () => Promise.resolve('C:\\Python Debugger\\debugpy') },
            });
            const launch = await s.preparation.prepare(s.folder, {});
            const env = await s.preparation.workerEnvironment(launch, 9001, 'pipe');
            expect(env.languageWorkers__python__defaultExecutablePath).to.equal(python.fsPath);
            expect(env.languageWorkers__python__arguments).to.equal('"C:\\Python Debugger\\debugpy" "--listen" "127.0.0.1:9001" "--wait-for-client"');
            expect(env.CUSTOM_PYTHON_ENV).to.equal('configured');
            expect(env.VIRTUAL_ENV).to.equal(virtualEnvironment.fsPath);
            expect(env.PATH).to.contain('environment-path');
            expect(launcher.mock.calls[0].arguments).to.deep.equal(['127.0.0.1', 9001, true]);
            const overriddenLaunch = await s.preparation.prepare(s.folder, {
                ['CUSTOM_PYTHON_ENV']: 'launch', [pathName]: 'launch-path',
                [platform === 'win32' ? 'Virtual_Env' : 'VIRTUAL_ENV']: 'another-environment',
            });
            const overridden = await s.preparation.workerEnvironment(overriddenLaunch, 9001, 'pipe');
            expect(overridden.CUSTOM_PYTHON_ENV).to.equal('launch');
            expect(overridden.PATH).to.equal(`${executableDirectory.fsPath}${delimiter}${expectedPath}`);
            expect(overridden.VIRTUAL_ENV).to.equal(virtualEnvironment.fsPath);
            if (platform === 'win32') {
                expect(Object.keys(overridden).filter(key => key.toLowerCase() === 'path')).to.deep.equal(['PATH']);
                expect(Object.keys(overridden).filter(key => key.toLowerCase() === 'virtual_env')).to.deep.equal(['VIRTUAL_ENV']);
            }
            expect(overridden.languageWorkers__python__defaultExecutablePath).to.equal(python.fsPath);
            const resolved = await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
                ...s.config, env: { [platform === 'win32' ? 'Virtual_Env' : 'VIRTUAL_ENV']: 'another-environment' },
            });
            expect(resolved?.type).to.equal('debugpy');
            const spawnedEnvironment = s.spawn.mock.calls[0].arguments[2]?.env ?? {};
            expect(Object.entries(spawnedEnvironment).filter(([key]) => key.toLowerCase() === 'virtual_env').map(([, value]) => value))
                .to.deep.equal([virtualEnvironment.fsPath]);
        });
    }

    it('sets language worker debugging arguments and unique PowerShell pipe names', async () => {
        const s = setup();
        addMockExtension(s.m, 'vscjava.vscode-java-debug', {});
        addMockExtension(s.m, 'ms-vscode.PowerShell', {});
        const node = await s.preparation.prepare(s.folder, {});
        const java = await s.preparation.prepare(s.folder, { ['FUNCTIONS_WORKER_RUNTIME']: 'java' });
        const powershell = await s.preparation.prepare(s.folder, { ['FUNCTIONS_WORKER_RUNTIME']: 'powershell' });
        expect((await s.preparation.workerEnvironment(node, 9001, 'pipe')).languageWorkers__node__arguments).to.equal('--inspect-brk=127.0.0.1:9001');
        expect((await s.preparation.workerEnvironment(java, 9002, 'pipe')).languageWorkers__java__arguments).to.include('address=127.0.0.1:9002');
        expect((await s.preparation.workerEnvironment(powershell, 9003, 'owned-pipe')).PSWorkerCustomPipeName).to.equal('owned-pipe');
    });

    it('activates the JavaScript debugger before attaching because the resolved debug type bypasses its activation event', async () => {
        const s = setup();
        const jsDebug = s.m.installedExtensions.get('ms-vscode.js-debug');
        if (!jsDebug) { throw new Error('The fixture did not register the JavaScript debugger.'); }
        const activate = mock.method(jsDebug, 'activate');
        const launch = await s.preparation.prepare(s.folder, {});
        await s.preparation.workerEnvironment(launch, 9001, 'pipe');
        expect(activate.mock.callCount()).to.equal(1);
    });

    it('reports a missing JavaScript debugger before starting a Node host', async () => {
        const s = setup();
        s.m.installedExtensions.delete('ms-vscode.js-debug');
        const launch = await s.preparation.prepare(s.folder, {});
        await expect(s.preparation.workerEnvironment(launch, 9001, 'pipe')).to.be.rejectedWith('ms-vscode.js-debug');
    });

    it('starts Go with the owned Delve executable, loopback port, and worker argument separator', async () => {
        const s = setup('native');
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'bin', process.platform === 'win32' ? 'app.exe' : 'app'), 'binary');
        const start = mock.method(s.owners, 'start', async (request: FunctionsHostStart) => {
            const env = await request.prepare(9004, 'unused');
            expect(env.languageWorkers__native__defaultExecutablePath).to.equal(s.code.Uri.file('/Go Tools/dlv').fsPath);
            expect(env.languageWorkers__native__arguments).to.include('"--listen=127.0.0.1:9004"');
            expect(env.languageWorkers__native__arguments).to.include('"--continue"');
            expect(env.languageWorkers__native__arguments).to.match(/ "--"$/);
            if (process.platform === 'win32') {
                expect(env.languageWorkers__native__arguments).to.include('"--redirect" "stdin:NUL" "--"');
            } else {
                expect(env.languageWorkers__native__arguments).to.not.include('--redirect');
            }
            expect(env.PATH).to.include(s.code.Uri.file('/Go Tools').fsPath).and.include('project-path');
            return { id: 'go-owned', hostPort: 7072, debugPort: 9004, pipe: 'unused' };
        });
        const config = await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, { ...s.config, env: { ['PATH']: 'project-path' } });
        expect(start.mock.callCount()).to.equal(1);
        expect(config?.type).to.equal('go');
        expect(config?.__azureFunctionsHostId).to.equal('go-owned');
    });

    it('reports missing Go debug binaries and protected argument overrides without starting a host', async () => {
        const s = setup('native');
        const start = mock.method(s.owners, 'start', async (request: FunctionsHostStart) => {
            await request.prepare(9004, 'unused');
            return { id: 'owned', hostPort: 7072, debugPort: 9004, pipe: 'unused' };
        });
        expect(await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, s.config)).to.be.undefined;
        expect(s.m.window.showErrorMessage.mock.calls.at(-1)?.arguments[0]).to.include('Build the Go Functions project');
        expect(s.spawn.mock.callCount()).to.equal(2);
        expect(start.mock.callCount()).to.equal(1);
        start.mock.resetCalls();
        for (const key of ['languageWorkers__native__arguments__0', 'languageWorkers:native:arguments', 'languageWorkers:native:defaultExecutablePath']) {
            expect(await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
                ...s.config, env: { [key]: 'unowned' },
            })).to.be.undefined;
        }
        expect(start.mock.callCount()).to.equal(0);
    });

    for (const runtime of ['node', 'python', 'java', 'powershell', 'dotnet-isolated', 'native']) {
        it(`assigns ${runtime} builds to the CLI or the Go debug build and honors build overrides`, async () => {
            const s = setup(runtime);
            const buildGo = mock.method(s.preparation, 'buildGo', (launch: Extract<FunctionsDebugLaunch, { readonly runtime: 'native' }>) => {
                expect(launch.project.toString()).to.equal(s.folder.toString());
                expect(launch.environment.AzureWebJobsStorage).to.equal('UseDevelopmentStorage=true');
                return Promise.resolve();
            });
            const start = mock.method(s.owners, 'start', () => Promise.resolve({
                id: 'owned', hostPort: 7072, debugPort: 9229, pipe: 'pipe', workerPid: 1234,
            }));
            for (const overrides of [{ skipBuild: false }, { skipBuild: true }, { skipBuild: false, preLaunchTask: 'my-build' }]) {
                const config = await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, { ...s.config, ...overrides });
                expect(config?.request).to.equal('attach');
                const request = start.mock.calls.at(-1)?.arguments[0];
                expect(request?.project.toString()).to.equal(s.folder.toString());
                expect(request?.skipBuild).to.equal(runtime === 'native' || overrides.skipBuild || !!overrides.preLaunchTask);
            }
            expect(start.mock.callCount()).to.equal(3);
            expect(buildGo.mock.callCount()).to.equal(runtime === 'native' ? 1 : 0);
        });
    }

    it('reports a failed Go debug build before launching its host', async () => {
        const s = setup('native');
        mock.method(s.preparation, 'buildGo', () => Promise.reject(new Error('Go compilation failed')));
        const start = mock.method(s.owners, 'start');
        const config = await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
            ...s.config, skipBuild: false,
        });
        expect(config).to.be.undefined;
        expect(start.mock.callCount()).to.equal(0);
        expect(s.m.window.showErrorMessage.mock.calls.at(-1)?.arguments[0]).to.include('Go compilation failed');
    });

    it('offers the previously chosen project first and marks it recently selected in a multi-project workspace', async () => {
        const s = setup();
        const nested = s.code.Uri.joinPath(s.folder, 'nested');
        s.m.fs.addFile(s.code.Uri.joinPath(nested, 'host.json'), '{}');

        const first = s.projects.select();
        await waitFor(() => s.m.quickPicks.some(pick => pick.show.mock.callCount() > 0), 'the project picker');
        const firstPicker = s.m.quickPicks[0];
        expect(firstPicker.items.map(item => item.label)).to.have.members([s.folder.fsPath, nested.fsPath]);
        const nestedItem = firstPicker.items.find(item => item.label === nested.fsPath);
        if (!nestedItem) { throw new Error('Expected the nested project to be offered.'); }
        firstPicker.activeItems = [nestedItem];
        firstPicker.accept();
        expect((await first).toString()).to.equal(nested.toString());

        const second = s.projects.select();
        await waitFor(() => s.m.quickPicks.length > 1 && s.m.quickPicks[1].show.mock.callCount() > 0, 'the second project picker');
        const secondPicker = s.m.quickPicks[1];
        expect(secondPicker.items[0].label).to.equal(nested.fsPath);
        expect(secondPicker.items[0].description).to.include('recently selected');
        expect(secondPicker.activeItems.map(item => item.label)).to.deep.equal([nested.fsPath]);
        secondPicker.accept();
        expect((await second).toString()).to.equal(nested.toString());
    });

    it('filters dynamic configurations to their owning workspace folder', async () => {
        const s = setup();
        const other = addWorkspaceFolder(s.m, '/other');
        s.m.fs.addFile(s.code.Uri.joinPath(other.uri, 'host.json'), '{}');
        const configs = await s.debugProvider.provideDebugConfigurations(other);
        expect(configs).to.have.length(1);
        expect(configs[0].projectPath).to.equal(other.uri.fsPath);
    });

    it('resolves relative project paths against their workspace folder', async () => {
        const s = setup();
        const nested = s.code.Uri.joinPath(s.folder, 'nested', 'app');
        s.m.fs.addFile(s.code.Uri.joinPath(nested, 'host.json'), '{}');
        const workspace = s.code.workspace.getWorkspaceFolder(s.folder);
        expect((await s.projects.select(workspace, 'nested\\app')).toString()).to.equal(nested.toString());
    });

    it('explains when an explicit project path has no host.json', async () => {
        const s = setup();
        const missing = s.code.Uri.joinPath(s.folder, 'missing');
        await expect(s.projects.select(undefined, missing)).to.be.rejectedWith(ExternalError, 'does not contain host.json');
    });

    it('propagates filesystem permissions failures when validating an explicit project path', async () => {
        const s = setup();
        const error = s.code.FileSystemError.NoPermissions();
        mock.method(s.code.workspace.fs, 'stat', () => Promise.reject(error));
        await expect(s.projects.select(undefined, s.folder)).to.be.rejectedWith(error);
    });

    it('rejects an untrusted workspace, protected flags, and invalid ports before tool acquisition', async () => {
        const s = setup();
        mock.property(s.m.workspace, 'isTrusted', false);
        expect(await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, s.config)).to.be.undefined;
        const trusted = setup();
        for (const flag of ['--port=7000', '-p', '--output=json', '--no-tui',
            '--host-version=4.1049.0', '-v', '--profile=other', '--enable-auth', '--no-build=false',
            '--dotnet-isolated-debug', '--enable-json-output', '--json-output-file=worker.json',
            '--PORT=7000', '--useHttps', '--enableAuth', '--language-worker=other']) {
            expect(await trusted.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, { ...trusted.config, hostArgs: [flag] })).to.be.undefined;
        }
        expect(await trusted.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, { ...trusted.config, debugPort: 0 })).to.be.undefined;
        for (const key of ['PSWorkerCustomPipeName', 'FUNCTIONS_WORKER_PROCESS_COUNT', 'languageWorkers__python__arguments__0',
            'LANGUAGEWORKERS:java:defaultExecutablePath', 'languageWorkers__node:arguments', 'languageWorkers:node:arguments:0']) {
            expect(await trusted.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
                ...trusted.config, env: { [key]: 'unowned' },
            })).to.be.undefined;
        }
        expect(s.tools.acquire.mock.callCount()).to.equal(0);
        expect(trusted.tools.acquire.mock.callCount()).to.equal(0);
    });

    it('requires storage configuration but leaves a development emulator to the host', async () => {
        const s = setup();
        mock.method(s.network, 'listening', () => Promise.resolve(false));
        expect((await s.preparation.prepare(s.folder, {})).runtime).to.equal('node');
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'local.settings.json'), '{"Values":{"FUNCTIONS_WORKER_RUNTIME":"node"}}');
        await expect(s.preparation.prepare(s.folder, {})).to.be.rejectedWith('Configure AzureWebJobsStorage');
        expect((await s.preparation.prepare(s.folder, { ['AzureWebJobsStorage__accountName']: 'account' })).runtime).to.equal('node');
    });

    it('passes a user-supplied --no-azurite host argument through and checks workloads before starting the host', async () => {
        const s = setup();
        const start = mock.method(s.owners, 'start', async (request: FunctionsHostStart) => {
            expect(s.ensureWorkloads.mock.callCount()).to.equal(1);
            expect(request.hostArgs).to.deep.equal(['--no-azurite']);
            await request.prepare(9229, 'pipe');
            return { id: 'owned', hostPort: 7072, debugPort: 9229, pipe: 'pipe' };
        });
        await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, { ...s.config, hostArgs: ['--no-azurite'] });
        expect(start.mock.callCount()).to.equal(1);
    });

    it('does not acquire tools or start a host after cancellation', async () => {
        const s = setup();
        const token = new MockCancellationToken();
        token.cancel();
        expect(await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, s.config, token)).to.be.undefined;
        expect(s.tools.acquire.mock.callCount()).to.equal(0);
        expect(s.spawn.mock.callCount()).to.equal(0);
    });

    it('registers resolve hooks once and keeps the dynamic registration provide-only', () => {
        const s = setup();
        s.debugProvider.register();
        const calls = s.m.debug.registerDebugConfigurationProvider.mock.calls;
        const withResolve = calls.filter(call => 'resolveDebugConfigurationWithSubstitutedVariables' in call.arguments[1]);
        expect(calls).to.have.length(2);
        expect(withResolve).to.have.length(1);
        expect(calls.find(call => !withResolve.includes(call))?.arguments[1]).to.have.property('provideDebugConfigurations');
        expect(withResolve[0].arguments[1]).to.not.have.property('provideDebugConfigurations');
    });

    it('selects the canonical indexed project for a path with a trailing separator', async () => {
        const s = setup();
        const selected = await s.projects.select(undefined, `${s.folder.fsPath}/`);
        expect(selected.toString()).to.equal(s.folder.toString());
    });

    it('cleans up attach failures before session start and normal session termination without touching unowned sessions', async () => {
        const s = setup();
        const stop = mock.method(s.owners, 'stop', () => Promise.resolve());
        s.debugProvider.register();
        const factory = s.m.debug.registerDebugAdapterTrackerFactory.mock.calls[0].arguments[1];
        const session: vscode.DebugSession = {
            id: 'session', type: 'pwa-node', name: 'Functions', configuration: { ...s.config, ['__azureFunctionsHostId']: 'owned' },
            workspaceFolder: undefined,
            customRequest: () => Promise.resolve(), getDebugProtocolBreakpoint: () => Promise.resolve(undefined),
        };
        const tracker = await factory.createDebugAdapterTracker(session);
        tracker?.onError?.(new Error('attach failed'));
        s.m.debugSessionEndEmitter.fire(session);
        expect(stop.mock.calls.map(call => call.arguments[0])).to.deep.equal(['owned', 'owned']);
        expect(await factory.createDebugAdapterTracker({ ...session, configuration: s.config })).to.be.undefined;
    });
});
