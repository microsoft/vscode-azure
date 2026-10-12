/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addMockExtension, getMockTaskExecution, MockShellExecution } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { createFunctionsDebugFixture } from './mockFunctionsDebug';

describe('Functions debug preparation (unit)', () => {
    const fixtures: ReturnType<typeof createFunctionsDebugFixture>[] = [];
    function setup(runtime = 'node') {
        const s = createFunctionsDebugFixture(runtime);
        fixtures.push(s);
        return s;
    }
    afterEach(() => { fixtures.splice(0).forEach(s => { s.dispose(); }); mock.restoreAll(); });

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

    it('installs Python requirements with the selected interpreter and reports a missing debugger extension', async () => {
        const s = setup('python');
        const executable = s.code.Uri.joinPath(s.folder, '.venv', 'python.exe');
        addMockExtension(s.m, 'ms-python.python', {
            ready: Promise.resolve(), environments: {
                getActiveEnvironmentPath: () => ({ path: executable.fsPath }),
                resolveEnvironment: () => Promise.resolve({ executable: { uri: executable } }),
                getEnvironmentVariables: () => ({}),
            },
        });
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
});
