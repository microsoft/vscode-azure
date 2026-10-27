/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, readText } from '@microsoft/vscode-azure-utils';
import { addMockExtension, getMockTaskExecution, MockCancellationToken, MockShellExecution, respondToPrompts, waitFor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { parse } from 'jsonc-parser';
import { createFunctionsDebugFixture, selectPythonEnvironment } from './mockFunctionsDebug';

describe('Functions debug preparation (unit)', () => {
    const fixtures: ReturnType<typeof createFunctionsDebugFixture>[] = [];
    function setup(runtime = 'node', processOptions?: Parameters<typeof createFunctionsDebugFixture>[1]) {
        const s = createFunctionsDebugFixture(runtime, processOptions);
        fixtures.push(s);
        return s;
    }
    afterEach(() => { fixtures.splice(0).forEach(s => { s.dispose(); }); mock.restoreAll(); });

    for (const [runtime, label] of [
        ['node', 'Node.js / TypeScript'], ['python', 'Python'], ['dotnet-isolated', '.NET isolated'],
        ['java', 'Java'], ['powershell', 'PowerShell'], ['native', 'Go (native worker)'],
    ]) {
        it(`persists the selected ${runtime} and reuses it on subsequent launches while preserving settings`, async () => {
            const s = setup(runtime);
            const uri = s.code.Uri.joinPath(s.folder, 'local.settings.json');
            const settings = '{\r\n // keep this comment\r\n "Values":{"functions_worker_runtime":" ", "AzureWebJobsStorage":"UseDevelopmentStorage=true", "Other":"preserved"},\r\n "Host":{"LocalHttpPort":8090}, "ConnectionStrings":{"database":"preserved"}\r\n}';
            s.m.fs.addFile(uri, settings);
            const prompts = respondToPrompts(s.m, [{ pick: label }]);
            const launch = await s.preparation.prepare(s.folder, {});
            prompts.assertAllConsumed();
            expect(launch.runtime).to.equal(runtime);
            expect(launch.environment.FUNCTIONS_WORKER_RUNTIME).to.equal(runtime);
            const text = await readText(s.code, uri);
            expect(text).to.include('// keep this comment').and.include('\r\n');
            const data: unknown = parse(text ?? '');
            expect(data).to.deep.equal({
                Values: { ['functions_worker_runtime']: runtime, ['AzureWebJobsStorage']: 'UseDevelopmentStorage=true', Other: 'preserved' },
                Host: { LocalHttpPort: 8090 }, ConnectionStrings: { database: 'preserved' },
            });
            expect((await s.preparation.prepare(s.folder, {})).runtime).to.equal(runtime);
            expect(s.m.quickPicks).to.have.length(1);
            expect(s.m.fs.writeFile.mock.callCount()).to.equal(1);
        });
    }

    it('rechecks cancellation after runtime selection before continuing preparation', async () => {
        const s = setup('');
        const token = new MockCancellationToken();
        const preparing = s.preparation.prepare(s.folder, {}, token);
        const rejected = expect(preparing).to.be.rejectedWith(CancellationError);
        await waitFor(() => s.m.quickPicks.some(pick => pick.show.mock.callCount() > 0));
        const picker = s.m.quickPicks[0];
        token.cancel();
        picker.activeItems = [picker.items[0]];
        picker.accept();
        await rejected;
        expect(s.spawn.mock.callCount()).to.equal(0);
        expect(s.tools.acquire.mock.callCount()).to.equal(0);
        expect(s.m.fs.writeFile.mock.callCount()).to.equal(0);
    });

    it('rechecks workspace trust after runtime selection', async () => {
        const s = setup('');
        const preparing = s.preparation.prepare(s.folder, {});
        const rejected = expect(preparing).to.be.rejectedWith('trusted, non-virtual workspace');
        await waitFor(() => s.m.quickPicks.some(pick => pick.show.mock.callCount() > 0));
        const picker = s.m.quickPicks[0];
        mock.property(s.m.workspace, 'isTrusted', false);
        picker.activeItems = [picker.items[0]];
        picker.accept();
        await rejected;
        expect(s.spawn.mock.callCount()).to.equal(0);
        expect(s.tools.acquire.mock.callCount()).to.equal(0);
        expect(s.m.fs.writeFile.mock.callCount()).to.equal(0);
    });

    it('does not persist a runtime over settings made dirty while the picker is open', async () => {
        const s = setup('');
        const preparing = s.preparation.prepare(s.folder, {});
        const rejected = expect(preparing).to.be.rejectedWith('Save local.settings.json');
        await waitFor(() => s.m.quickPicks.some(pick => pick.show.mock.callCount() > 0));
        const document = await s.code.workspace.openTextDocument(s.code.Uri.joinPath(s.folder, 'local.settings.json'));
        mock.property(document, 'isDirty', true);
        const picker = s.m.quickPicks[0];
        picker.activeItems = [picker.items[0]];
        picker.accept();
        await rejected;
        expect(s.m.fs.writeFile.mock.callCount()).to.equal(0);
        expect(s.tools.acquire.mock.callCount()).to.equal(0);
    });

    it('validates mixed-case local setting names and gives launch overrides case-insensitive precedence', async () => {
        const s = setup();
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'local.settings.json'), JSON.stringify({
            Values: {
                ['functions_worker_runtime']: 'unsupported',
                ['functions_extension_version']: '~3',
                ['azurewebjobsstorage__accountname']: 'storage-account',
            },
        }));

        expect((await s.preparation.prepare(s.folder, {
            ['FUNCTIONS_WORKER_RUNTIME']: 'node', ['FUNCTIONS_EXTENSION_VERSION']: '~4',
        })).runtime).to.equal('node');
        await expect(s.preparation.prepare(s.folder, { ['FUNCTIONS_WORKER_RUNTIME']: 'node' }))
            .to.be.rejectedWith('runtime v4 only');
        expect(s.m.quickPicks).to.be.empty;
        expect(s.m.fs.writeFile.mock.callCount()).to.equal(0);
    });

    it('builds native Go with optimizations and inlining disabled using the resource-scoped Go executable', async () => {
        const s = setup('native');
        const launch = await s.preparation.prepare(s.folder, { ['CUSTOM_GO_ENV']: 'configured' });
        if (launch.runtime !== 'native') { throw new Error('Expected a native Go launch.'); }
        const building = s.preparation.buildGo(launch);
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
        await building;
    });

    it('propagates Go build failures before starting a worker', async () => {
        const s = setup('native');
        const launch = await s.preparation.prepare(s.folder, {});
        if (launch.runtime !== 'native') { throw new Error('Expected a native Go launch.'); }
        const building = s.preparation.buildGo(launch);
        const rejected = expect(building).to.be.rejectedWith('failed with exit code 1');
        const build = await getMockTaskExecution(s.m);
        s.m.taskProcessEndEmitter.fire({ execution: build, exitCode: 1 });
        await rejected;
    });

    it('uses the validated Go tools and merged environment for build and startup while resolving each launch independently', async () => {
        const s = setup('native');
        const command = mock.fn((tool: string, _resource?: unknown) => ({ binPath: s.code.Uri.file(`/Selected Tools/${tool}`).fsPath }));
        addMockExtension(s.m, 'golang.Go', { settings: { getExecutionCommand: command } });
        const read = mock.method(s.settings, 'read');
        const launch = await s.preparation.prepare(s.folder, { ['CUSTOM_GO_ENV']: 'launch' });
        if (launch.runtime !== 'native') { throw new Error('Expected a native Go launch.'); }
        command.mock.mockImplementation((tool: string) => ({ binPath: s.code.Uri.file(`/Other Tools/${tool}`).fsPath }));
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'local.settings.json'), JSON.stringify({
            Values: { ['FUNCTIONS_WORKER_RUNTIME']: 'native', ['AzureWebJobsStorage__accountName']: 'updated' },
        }));

        const building = s.preparation.buildGo(launch);
        const build = await getMockTaskExecution(s.m);
        if (!(build.task.execution instanceof MockShellExecution)) { throw new Error('Expected a shell task.'); }
        const executable = build.task.execution.command;
        expect(typeof executable === 'string' ? executable : executable?.value).to.equal(s.code.Uri.file('/Selected Tools/go').fsPath);
        expect(build.task.execution.options?.env?.CUSTOM_GO_ENV).to.equal('launch');
        expect(build.task.execution.options?.env?.AzureWebJobsStorage).to.equal('UseDevelopmentStorage=true');
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'bin', process.platform === 'win32' ? 'app.exe' : 'app'), 'binary');
        s.m.taskProcessEndEmitter.fire({ execution: build, exitCode: 0 });
        await building;
        const environment = await s.preparation.workerEnvironment(launch, 9004, 'unused');
        expect(environment.languageWorkers__native__defaultExecutablePath).to.equal(s.code.Uri.file('/Selected Tools/dlv').fsPath);
        expect(environment.CUSTOM_GO_ENV).to.equal('launch');
        expect(environment.AzureWebJobsStorage).to.equal('UseDevelopmentStorage=true');
        expect(command.mock.callCount()).to.equal(2);
        expect(command.mock.calls.map(call => call.arguments[1])).to.deep.equal([s.folder, s.folder]);
        expect(read.mock.callCount()).to.equal(1);

        const next = await s.preparation.prepare(s.folder, {});
        if (next.runtime !== 'native') { throw new Error('Expected a native Go launch.'); }
        expect(next.tools.go).to.equal(s.code.Uri.file('/Other Tools/go').fsPath);
        expect(next.environment.AzureWebJobsStorage__accountName).to.equal('updated');
        expect(command.mock.callCount()).to.equal(4);
        expect(read.mock.callCount()).to.equal(2);
    });

    for (const version of ['1.24.0', '1.25.1', '2.0.0']) {
        it(`accepts Go ${version} and validates Delve for the selected project`, async () => {
            const s = setup('native', { stdout: `go version go${version} windows/amd64\nDelve Debugger\nVersion: 1.25.0\n` });
            expect((await s.preparation.prepare(s.folder, {})).runtime).to.equal('native');
            expect(s.spawn.mock.calls.map(call => call.arguments[1])).to.deep.equal([['version'], ['version']]);
            expect(s.tools.acquire.mock.callCount()).to.equal(0);
        });
    }

    for (const output of ['go version go1.23.9 windows/amd64', 'go version go0.99.0 windows/amd64', 'not a Go version']) {
        it(`rejects unsupported toolchain output: ${output}`, async () => {
            const s = setup('native', { stdout: output });
            await expect(s.preparation.prepare(s.folder, {})).to.be.rejectedWith('Go 1.24 or later');
            expect(s.spawn.mock.callCount()).to.equal(1);
        });
    }

    it('requires the Go extension public API, a Go module, and usable Go/Delve tools', async () => {
        const s = setup('native');
        s.m.installedExtensions.delete('golang.Go');
        await expect(s.preparation.prepare(s.folder, {})).to.be.rejectedWith('Install the Go extension');
        addMockExtension(s.m, 'golang.Go', {});
        await expect(s.preparation.prepare(s.folder, {})).to.be.rejectedWith('public tool execution API');
        addMockExtension(s.m, 'golang.Go', { settings: { getExecutionCommand: () => undefined } });
        await expect(s.preparation.prepare(s.folder, {})).to.be.rejectedWith('Select a Go toolchain');
        await s.code.workspace.fs.delete(s.code.Uri.joinPath(s.folder, 'go.mod'));
        await expect(s.preparation.prepare(s.folder, {})).to.be.rejectedWith('project with go.mod');
        const missing = setup('native', { spawnError: new Error('Tool missing') });
        await expect(missing.preparation.prepare(missing.folder, {})).to.be.rejectedWith('Could not run the Go debugging tools');
        const malformed = setup('native', { stdout: 'go version go1.24.0 windows/amd64' });
        await expect(malformed.preparation.prepare(malformed.folder, {})).to.be.rejectedWith('Delve did not report a valid version');
    });

    it('cancels a Go tool probe without acquiring Core Tools or starting a host', async () => {
        const s = setup('native', { keepAlive: true });
        const token = new MockCancellationToken();
        const resolved = s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(
            undefined, { type: 'azure-functions', request: 'launch', name: 'Functions', projectPath: s.folder.fsPath }, token);
        await waitFor(() => s.spawn.mock.callCount() === 1);
        token.cancel();
        expect(await resolved).to.be.undefined;
        expect(s.tools.acquire.mock.callCount()).to.equal(0);
        expect(s.m.tasks.executeTask.mock.callCount()).to.equal(0);
    });

    it('rejects project-level native worker overrides instead of borrowing another debugger', async () => {
        const s = setup('native');
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'bin', process.platform === 'win32' ? 'app.exe' : 'app'), 'binary');
        for (const key of ['languageWorkers__native__arguments', 'languageWorkers:native:arguments:0', 'languageWorkers:native:defaultExecutablePath']) {
            const launch = await s.preparation.prepare(s.folder, { [key]: 'unowned' });
            await expect(s.preparation.workerEnvironment(launch, 9004, 'unused'))
                .to.be.rejectedWith('Native worker executable and argument overrides');
        }
    });

    it('reports a missing Python Debugger extension for worker preparation', async () => {
        const s = setup('python');
        const launch = await s.preparation.prepare(s.folder, {});
        await expect(s.preparation.workerEnvironment(launch, 9001, 'pipe')).to.be.rejectedWith('Install the Python Debugger');
    });

    it('requires a selected Python virtual environment before tool acquisition or host launch', async () => {
        const s = setup('python');
        const executable = s.code.Uri.file('/system/python');
        selectPythonEnvironment(s, executable);
        const resolved = await s.debugProvider.resolveDebugConfigurationWithSubstitutedVariables(
            undefined, { type: 'azure-functions', request: 'launch', name: 'Functions', projectPath: s.folder.fsPath }, new MockCancellationToken());
        expect(resolved).to.be.undefined;
        expect(s.m.window.showErrorMessage.mock.calls.at(-1)?.arguments[0]).to.include('Select a Python virtual environment');
        expect(s.tools.acquire.mock.callCount()).to.equal(0);
        expect(s.spawn.mock.callCount()).to.equal(0);
        expect(s.m.tasks.executeTask.mock.callCount()).to.equal(0);
    });
});
