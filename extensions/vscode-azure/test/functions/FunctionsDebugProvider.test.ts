/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addMockExtension, addWorkspaceFolder, MockCancellationToken, waitFor } from '@microsoft/vscode-azure-utils/testing';
import { delimiter } from 'node:path';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
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

    for (const [runtime, type] of [['node', 'pwa-node'], ['python', 'debugpy'], ['java', 'java'], ['powershell', 'PowerShell'], ['dotnet-isolated', 'coreclr'], ['native', 'go']]) {
        it(`returns ${runtime} attach coordinates owned by the selected project`, async () => {
            const s = setup(runtime);
            mock.method(s.preparation, 'hostDirectory', () => Promise.resolve(s.folder));
            mock.method(s.preparation, 'workerEnvironment', () => Promise.resolve({}));
            const start = mock.method(s.owners, 'start', async (request: FunctionsHostStart) => {
                const env = await request.prepare(9229, 'owned-pipe');
                expect(env.FUNCTIONS_WORKER_RUNTIME).to.equal(runtime);
                expect(env.FUNCTIONS_WORKER_PROCESS_COUNT).to.equal('1');
                return { id: 'owned', hostPort: 7072, debugPort: 9229, pipe: 'owned-pipe', workerPid: 1234 };
            });
            const config = await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, s.config);
            expect(config?.type).to.equal(type);
            expect(config?.request).to.equal('attach');
            expect(config?.__azureFunctionsHostId).to.equal('owned');
            expect(config?.preLaunchTask).to.be.undefined;
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
            const env = await s.preparation.workerEnvironment(s.folder, 'python', 9001, 'pipe');
            expect(env.languageWorkers__python__defaultExecutablePath).to.equal(python.fsPath);
            expect(env.languageWorkers__python__arguments).to.equal('"C:\\Python Debugger\\debugpy" "--listen" "127.0.0.1:9001" "--wait-for-client"');
            expect(env.CUSTOM_PYTHON_ENV).to.equal('configured');
            expect(env.VIRTUAL_ENV).to.equal(virtualEnvironment.fsPath);
            expect(env.PATH).to.contain('environment-path');
            expect(launcher.mock.calls[0].arguments).to.deep.equal(['127.0.0.1', 9001, true]);
            const overridden = await s.preparation.workerEnvironment(s.folder, 'python', 9001, 'pipe', {
                ['CUSTOM_PYTHON_ENV']: 'launch', [pathName]: 'launch-path',
                [platform === 'win32' ? 'Virtual_Env' : 'VIRTUAL_ENV']: 'another-environment',
            });
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
        expect((await s.preparation.workerEnvironment(s.folder, 'node', 9001, 'pipe')).languageWorkers__node__arguments).to.equal('--inspect-brk=127.0.0.1:9001');
        expect((await s.preparation.workerEnvironment(s.folder, 'java', 9002, 'pipe')).languageWorkers__java__arguments).to.include('address=127.0.0.1:9002');
        expect((await s.preparation.workerEnvironment(s.folder, 'powershell', 9003, 'owned-pipe')).PSWorkerCustomPipeName).to.equal('owned-pipe');
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

    it('runs the built-in build only when neither skipBuild nor preLaunchTask replaces it', async () => {
        const s = setup();
        const build = mock.method(s.preparation, 'build', () => Promise.resolve(s.folder));
        mock.method(s.owners, 'start', () => Promise.resolve({ id: 'owned', hostPort: 7072, debugPort: 9229, pipe: 'pipe' }));
        await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, { ...s.config, skipBuild: false });
        expect(build.mock.callCount()).to.equal(1);
        await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, { ...s.config, skipBuild: false, preLaunchTask: 'my-build' });
        await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, s.config);
        expect(build.mock.callCount()).to.equal(1);
    });

    it('offers project selection with the remembered project active in a multi-project workspace', async () => {
        const s = setup();
        const nested = s.code.Uri.joinPath(s.folder, 'nested');
        s.m.fs.addFile(s.code.Uri.joinPath(nested, 'host.json'), '{}');
        await s.context.ctx.extensionContext.workspaceState.update('functions.lastDebugProject', nested.toString());
        const selecting = s.projects.select();
        await waitFor(() => s.m.quickPicks.some(pick => pick.show.mock.callCount() > 0), 'the project picker');
        const picker = s.m.quickPicks[0];
        expect(picker.items.map(item => item.label)).to.have.members([s.folder.fsPath, nested.fsPath]);
        expect(picker.activeItems.map(item => item.label)).to.deep.equal([nested.fsPath]);
        picker.accept();
        expect((await selecting).toString()).to.equal(nested.toString());
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

    it('rejects an untrusted workspace, protected flags, and invalid ports before tool acquisition', async () => {
        const s = setup();
        mock.property(s.m.workspace, 'isTrusted', false);
        expect(await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, s.config)).to.be.undefined;
        const trusted = setup();
        for (const flag of ['--port=7000', '-p', '--output=json', '--no-tui', '--no-azurite=false',
            '--host-version=4.1049.0', '-v', '--profile=other', '--enable-auth', '--no-build=false',
            '--dotnet-isolated-debug', '--enable-json-output', '--json-output-file=worker.json']) {
            expect(await trusted.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, { ...trusted.config, hostArgs: [flag] })).to.be.undefined;
        }
        expect(await trusted.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, { ...trusted.config, debugPort: 0 })).to.be.undefined;
        expect(await trusted.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, { ...trusted.config, env: { ['PSWorkerCustomPipeName']: 'unowned' } })).to.be.undefined;
        expect(s.tools.acquire.mock.callCount()).to.equal(0);
        expect(trusted.tools.acquire.mock.callCount()).to.equal(0);
    });

    it('requires storage configuration and a running development emulator', async () => {
        const s = setup();
        mock.method(s.network, 'listening', () => Promise.resolve(false));
        await expect(s.preparation.validate(s.folder, {})).to.be.rejectedWith('Start Azurite');
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'local.settings.json'), '{"Values":{"FUNCTIONS_WORKER_RUNTIME":"node"}}');
        await expect(s.preparation.validate(s.folder, {})).to.be.rejectedWith('Configure AzureWebJobsStorage');
        expect(await s.preparation.validate(s.folder, { ['AzureWebJobsStorage__accountName']: 'account' })).to.equal('node');
    });

    it('does not acquire tools or start a host after cancellation', async () => {
        const s = setup();
        const token = new MockCancellationToken();
        token.cancel();
        expect(await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, s.config, token)).to.be.undefined;
        expect(s.tools.acquire.mock.callCount()).to.equal(0);
        expect(s.spawn.mock.callCount()).to.equal(0);
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
