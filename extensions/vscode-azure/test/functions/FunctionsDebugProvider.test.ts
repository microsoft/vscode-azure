/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addMockExtension, addWorkspaceFolder, MockCancellationToken, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import type { FunctionsHostStart } from '../../src/functions/host/LocalFunctionsHostProcess';
import { createFunctionsDebugFixture } from './mockFunctionsDebug';

describe('Functions debug provider (unit)', () => {
    const fixtures: ReturnType<typeof createFunctionsDebugFixture>[] = [];
    function setup(runtime = 'node') {
        const s = createFunctionsDebugFixture(runtime);
        fixtures.push(s);
        const config = { type: 'azure-functions', request: 'launch', name: 'Functions', projectPath: s.folder.fsPath, skipBuild: true };
        return { ...s, config };
    }
    afterEach(() => { fixtures.splice(0).forEach(s => { s.dispose(); }); mock.restoreAll(); });

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
            expect(s.tools.acquire.mock.calls[0].arguments[0].versionRange).to.equal('>=4.15.2 <5.0.0');
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

    it('uses the selected interpreter and safely quotes the debugger package path with spaces', async () => {
        const s = setup('python');
        const python = s.code.Uri.joinPath(s.folder, '.venv', 'Scripts', 'python.exe');
        addMockExtension(s.m, 'ms-python.python', {
            ready: Promise.resolve(),
            environments: {
                getActiveEnvironmentPath: () => ({ path: python.fsPath }),
                resolveEnvironment: () => Promise.resolve({ executable: { uri: python } }),
                getEnvironmentVariables: () => ({ ['CUSTOM_PYTHON_ENV']: 'configured' }),
            },
        });
        const launcher = mock.fn(() => Promise.resolve(['"C:\\Python Debugger\\debugpy"', '--listen', '127.0.0.1:9001', '--wait-for-client']));
        addMockExtension(s.m, 'ms-python.debugpy', {
            debug: { getRemoteLauncherCommand: launcher, getDebuggerPackagePath: () => Promise.resolve('C:\\Python Debugger\\debugpy') },
        });
        const env = await s.preparation.workerEnvironment(s.folder, 'python', 9001, 'pipe');
        expect(env.languageWorkers__python__defaultExecutablePath).to.equal(python.fsPath);
        expect(env.languageWorkers__python__arguments).to.equal('"C:\\Python Debugger\\debugpy" "--listen" "127.0.0.1:9001" "--wait-for-client"');
        expect(env.CUSTOM_PYTHON_ENV).to.equal('configured');
        expect(launcher.mock.calls[0].arguments).to.deep.equal(['127.0.0.1', 9001, true]);
        const overridden = await s.preparation.workerEnvironment(s.folder, 'python', 9001, 'pipe', {
            ['CUSTOM_PYTHON_ENV']: 'launch', ['PATH']: 'launch-path',
        });
        expect(overridden.CUSTOM_PYTHON_ENV).to.equal('launch');
        expect(overridden.PATH).to.contain('launch-path');
        expect(overridden.languageWorkers__python__defaultExecutablePath).to.equal(python.fsPath);
    });

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
        const prompts = respondToPrompts(s.m, [{ pick: nested.fsPath }]);
        expect((await s.projects.select()).toString()).to.equal(nested.toString());
        prompts.assertAllConsumed();
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
        expect(await trusted.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, { ...trusted.config, hostArgs: ['--port=7000'] })).to.be.undefined;
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
