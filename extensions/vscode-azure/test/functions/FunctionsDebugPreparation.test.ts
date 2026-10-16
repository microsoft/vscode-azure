/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from '@microsoft/vscode-azure-utils';
import { addMockExtension, getMockTaskExecution, MockCancellationToken, MockShellExecution, waitFor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { createFunctionsDebugFixture, selectPythonEnvironment } from './mockFunctionsDebug';

describe('Functions debug preparation (unit)', () => {
    const fixtures: ReturnType<typeof createFunctionsDebugFixture>[] = [];
    function setup(runtime = 'node', processOptions?: Parameters<typeof createFunctionsDebugFixture>[1]) {
        const s = createFunctionsDebugFixture(runtime, processOptions);
        fixtures.push(s);
        return s;
    }
    afterEach(() => { fixtures.splice(0).forEach(s => { s.dispose(); }); mock.restoreAll(); });

    it('validates mixed-case local setting names and gives launch overrides case-insensitive precedence', async () => {
        const s = setup();
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'local.settings.json'), JSON.stringify({
            Values: {
                ['functions_worker_runtime']: 'unsupported',
                ['functions_extension_version']: '~3',
                ['azurewebjobsstorage__accountname']: 'storage-account',
            },
        }));

        expect(await s.preparation.validate(s.folder, {
            ['FUNCTIONS_WORKER_RUNTIME']: 'node', ['FUNCTIONS_EXTENSION_VERSION']: '~4',
        })).to.equal('node');
        await expect(s.preparation.validate(s.folder, { ['FUNCTIONS_WORKER_RUNTIME']: 'node' }))
            .to.be.rejectedWith('runtime v4 only');
    });

    it('installs missing Node dependencies from the lockfile and applies the TypeScript build matcher', async () => {
        const s = setup();
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'package.json'), '{"scripts":{"build":"tsc"}}');
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'package-lock.json'), '{}');
        const building = s.preparation.build(s.folder, 'node', {});
        const install = await getMockTaskExecution(s.m);
        expect(install.task.execution).to.be.instanceOf(MockShellExecution);
        if (!(install.task.execution instanceof MockShellExecution)) { throw new Error('Expected a shell task.'); }
        expect(install.task.execution.args).to.deep.equal(['ci']);
        s.m.taskProcessEndEmitter.fire({ execution: install, exitCode: 0 });
        const build = await getMockTaskExecution(s.m, 1);
        expect(build.task.problemMatchers).to.include('$tsc');
        s.m.taskProcessEndEmitter.fire({ execution: build, exitCode: 0 });
        expect((await building).toString()).to.equal(s.folder.toString());
    });

    it('uses existing Node dependencies and runs the configured build script', async () => {
        const s = setup();
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'package.json'), '{"scripts":{"build":"tsc"}}');
        s.m.fs.addDirectory(s.code.Uri.joinPath(s.folder, 'node_modules'));
        const building = s.preparation.build(s.folder, 'node', {});
        const build = await getMockTaskExecution(s.m);
        if (!(build.task.execution instanceof MockShellExecution)) { throw new Error('Expected a shell task.'); }
        expect(build.task.execution.args).to.deep.equal(['run', 'build']);
        s.m.taskProcessEndEmitter.fire({ execution: build, exitCode: 0 });
        await building;
        expect(s.m.tasks.executeTask.mock.callCount()).to.equal(1);
    });

    it('builds isolated .NET with compiler diagnostics and propagates a build failure', async () => {
        const s = setup('dotnet-isolated');
        const building = s.preparation.build(s.folder, 'dotnet-isolated', {});
        const failed = expect(building).to.be.rejectedWith('failed with exit code 1');
        const build = await getMockTaskExecution(s.m);
        expect(build.task.problemMatchers).to.include('$msCompile');
        s.m.taskProcessEndEmitter.fire({ execution: build, exitCode: 1 });
        await failed;
    });

    it('packages Java and uses its sole generated app as the host working directory', async () => {
        const s = setup('java');
        const generated = s.code.Uri.joinPath(s.folder, 'target', 'azure-functions', 'app');
        s.m.fs.addDirectory(generated);
        const building = s.preparation.build(s.folder, 'java', {});
        const build = await getMockTaskExecution(s.m);
        if (!(build.task.execution instanceof MockShellExecution)) { throw new Error('Expected a shell task.'); }
        expect(build.task.execution.args).to.deep.equal(['package']);
        s.m.taskProcessEndEmitter.fire({ execution: build, exitCode: 0 });
        expect((await building).toString()).to.equal(generated.toString());
        s.m.fs.addDirectory(s.code.Uri.joinPath(s.folder, 'target', 'azure-functions', 'other'));
        await expect(s.preparation.hostDirectory(s.folder, 'java')).to.be.rejectedWith('exactly one Function App');
    });

    it('builds native Go with optimizations and inlining disabled using the resource-scoped Go executable', async () => {
        const s = setup('native');
        const building = s.preparation.build(s.folder, 'native', { ['CUSTOM_GO_ENV']: 'configured' });
        const build = await getMockTaskExecution(s.m);
        if (!(build.task.execution instanceof MockShellExecution)) { throw new Error('Expected a shell task.'); }
        const command = build.task.execution.command;
        if (!command) { throw new Error('Expected the Go executable.'); }
        expect(typeof command === 'string' ? command : command.value).to.equal(s.code.Uri.file('/Go Tools/go').fsPath);
        expect(build.task.execution.args).to.deep.equal([
            'build', '-gcflags=all=-N -l', '-o', s.code.Uri.joinPath(s.folder, 'bin', process.platform === 'win32' ? 'app.exe' : 'app').fsPath, '.',
        ]);
        expect(build.task.execution.options?.env?.CUSTOM_GO_ENV).to.equal('configured');
        s.m.taskProcessEndEmitter.fire({ execution: build, exitCode: 0 });
        expect((await building).toString()).to.equal(s.folder.toString());
    });

    it('propagates Go build failures before starting a worker', async () => {
        const s = setup('native');
        const building = s.preparation.build(s.folder, 'native', {});
        const rejected = expect(building).to.be.rejectedWith('failed with exit code 1');
        const build = await getMockTaskExecution(s.m);
        s.m.taskProcessEndEmitter.fire({ execution: build, exitCode: 1 });
        await rejected;
    });

    for (const version of ['1.24.0', '1.25.1', '2.0.0']) {
        it(`accepts Go ${version} and validates Delve for the selected project`, async () => {
            const s = setup('native', { stdout: `go version go${version} windows/amd64\nDelve Debugger\nVersion: 1.25.0\n` });
            expect(await s.preparation.validate(s.folder, {})).to.equal('native');
            expect(s.spawn.mock.calls.map(call => call.arguments[1])).to.deep.equal([['version'], ['version']]);
            expect(s.tools.acquire.mock.callCount()).to.equal(0);
        });
    }

    for (const output of ['go version go1.23.9 windows/amd64', 'go version go0.99.0 windows/amd64', 'not a Go version']) {
        it(`rejects unsupported toolchain output: ${output}`, async () => {
            const s = setup('native', { stdout: output });
            await expect(s.preparation.validate(s.folder, {})).to.be.rejectedWith('Go 1.24 or later');
            expect(s.spawn.mock.callCount()).to.equal(1);
        });
    }

    it('requires the Go extension public API, a Go module, and usable Go/Delve tools', async () => {
        const s = setup('native');
        s.m.installedExtensions.delete('golang.Go');
        await expect(s.preparation.validate(s.folder, {})).to.be.rejectedWith('Install the Go extension');
        addMockExtension(s.m, 'golang.Go', {});
        await expect(s.preparation.validate(s.folder, {})).to.be.rejectedWith('public tool execution API');
        addMockExtension(s.m, 'golang.Go', { settings: { getExecutionCommand: () => undefined } });
        await expect(s.preparation.validate(s.folder, {})).to.be.rejectedWith('Select a Go toolchain');
        await s.code.workspace.fs.delete(s.code.Uri.joinPath(s.folder, 'go.mod'));
        await expect(s.preparation.validate(s.folder, {})).to.be.rejectedWith('project with go.mod');
        const missing = setup('native', { spawnError: new Error('Tool missing') });
        await expect(missing.preparation.validate(missing.folder, {})).to.be.rejectedWith('Could not run the Go debugging tools');
        const malformed = setup('native', { stdout: 'go version go1.24.0 windows/amd64' });
        await expect(malformed.preparation.validate(malformed.folder, {})).to.be.rejectedWith('Delve did not report a valid version');
    });

    it('cancels a Go tool probe without acquiring Core Tools or starting a host', async () => {
        const s = setup('native', { keepAlive: true });
        const token = new MockCancellationToken();
        const validation = s.preparation.validate(s.folder, {}, token);
        const rejected = expect(validation).to.be.rejectedWith(CancellationError);
        await waitFor(() => s.spawn.mock.callCount() === 1);
        token.cancel();
        await rejected;
        expect(s.tools.acquire.mock.callCount()).to.equal(0);
        expect(s.m.tasks.executeTask.mock.callCount()).to.equal(0);
    });

    it('rejects project-level native worker overrides instead of borrowing another debugger', async () => {
        const s = setup('native');
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'bin', process.platform === 'win32' ? 'app.exe' : 'app'), 'binary');
        for (const key of ['languageWorkers__native__arguments', 'languageWorkers:native:arguments:0', 'languageWorkers:native:defaultExecutablePath']) {
            await expect(s.preparation.workerEnvironment(s.folder, 'native', 9004, 'unused', { [key]: 'unowned' }))
                .to.be.rejectedWith('Native worker executable and argument overrides');
        }
    });

    it('installs Python requirements with the selected interpreter and reports a missing debugger extension', async () => {
        const s = setup('python');
        const executable = s.code.Uri.joinPath(s.folder, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'requirements.txt'), 'azure-functions');
        const building = s.preparation.build(s.folder, 'python', {});
        const build = await getMockTaskExecution(s.m);
        if (!(build.task.execution instanceof MockShellExecution)) { throw new Error('Expected a shell task.'); }
        expect(build.task.execution.command).to.equal(executable.fsPath);
        expect(build.task.execution.args).to.deep.equal(['-m', 'pip', 'install', '-r', 'requirements.txt']);
        s.m.taskProcessEndEmitter.fire({ execution: build, exitCode: 0 });
        await building;
        await expect(s.preparation.workerEnvironment(s.folder, 'python', 9001, 'pipe')).to.be.rejectedWith('Install the Python Debugger');
    });

    it('requires a selected Python virtual environment before tool acquisition or host launch', async () => {
        const s = setup('python');
        const executable = s.code.Uri.file('/system/python');
        selectPythonEnvironment(s, executable);
        await expect(s.preparation.validate(s.folder, {})).to.be.rejectedWith('Select a Python virtual environment');
        expect(s.tools.acquire.mock.callCount()).to.equal(0);
        expect(s.spawn.mock.callCount()).to.equal(0);
        expect(s.m.tasks.executeTask.mock.callCount()).to.equal(0);
    });
});
