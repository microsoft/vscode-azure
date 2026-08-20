/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isProcessError, type ProcessError } from '@azure/core-process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { ShellQuoting, command } from '../../src/base/CommandLineBuilder';
import { createShellTask } from '../../src/vscode/createShellTask';
import { createMockVsCode } from './MockVsCode';

describe('createShellTask (unit)', () => {
    it('builds a configured task from a structured command line', () => {
        const m = createMockVsCode();
        const workspaceFolder: vscode.WorkspaceFolder = {
            uri: m.vscode.Uri.file('workspace'),
            name: 'workspace',
            index: 0,
        };
        const definition = { type: 'example', id: 'task' };
        const cwd = m.vscode.Uri.file('cwd');
        // An explicit path, so the assertion below does not depend on what
        // happens to be installed on the machine running the test.
        const executable = '/opt/contoso/tool';

        const task = createShellTask(m.vscode, {
            command: command(executable)
                .arg('plain')
                .quotedArg('quoted value'),
            definition,
            scope: workspaceFolder,
            name: 'Example task',
            source: 'example',
            problemMatchers: ['$example'],
            cwd,
            env: { EXAMPLE: 'value' },
            isBackground: true,
            presentationOptions: { focus: true },
            alwaysRunNew: true,
        });

        expect(task.definition).to.include(definition);
        expect(task.definition.idRandomizer).to.be.a('number');
        expect(task.scope).to.equal(workspaceFolder);
        expect(task.name).to.equal('Example task');
        expect(task.source).to.equal('example');
        expect(task.problemMatchers).to.deep.equal(['$example']);
        expect(task.isBackground).to.equal(true);
        expect(task.presentationOptions).to.deep.equal({ focus: true });

        const execution = task.execution as vscode.ShellExecution;
        // An explicit path keeps the caller's own spelling.
        expect(execution.command).to.equal(executable);
        expect(execution.args).to.deep.equal([
            'plain',
            { value: 'quoted value', quoting: ShellQuoting.Strong },
        ]);
        expect(execution.options).to.deep.equal({
            cwd: cwd.fsPath,
            env: { EXAMPLE: 'value' },
        });
    });

    it('uses process-task defaults', () => {
        const m = createMockVsCode();

        const task = createShellTask(m.vscode, {
            command: [process.execPath],
            name: 'Example task',
        });

        expect(task.definition).to.deep.equal({ type: 'shell' });
        expect(task.scope).to.equal(m.vscode.TaskScope.Workspace);
        expect(task.source).to.equal('process');
        expect(task.isBackground).to.equal(false);
    });

    it('rejects a bare command that is not on PATH', () => {
        const m = createMockVsCode();

        // A bare name is exactly the case a planted binary in the working
        // directory would satisfy, so it must not reach the shell.
        expect(() => createShellTask(m.vscode, {
            command: ['definitely-not-a-real-command-xyz'],
            name: 'Example task',
        })).to.throw(/could not be found on PATH/);
    });

    it('reports a missing bare command with the ENOENT code', () => {
        const m = createMockVsCode();

        try {
            createShellTask(m.vscode, {
                command: ['definitely-not-a-real-command-xyz'],
                name: 'Example task',
            });
            expect.fail('expected createShellTask to throw');
        } catch (e) {
            expect(isProcessError(e)).to.be.true;
            expect((e as ProcessError).code).to.equal('ENOENT');
        }
    });

    it('passes an unresolvable explicit path through unchanged', () => {
        const m = createMockVsCode();

        // An explicit path is the caller's deliberate choice, so there is no
        // hijack to prevent. Script targets rely on this, since they never
        // resolve as executables.
        const relative = './deploy.ps1';
        const task = createShellTask(m.vscode, {
            command: [relative],
            name: 'Example task',
        });

        const execution = task.execution as vscode.ShellExecution;
        expect(execution.command).to.equal(relative);
    });

    it('preserves the caller\'s quoting for an unresolvable explicit path', () => {
        const m = createMockVsCode();

        // Dropping the quoting here would let the shell split the path and run
        // whatever sits at the first fragment instead.
        const quoted = { value: './contoso tools/deploy.ps1', quoting: ShellQuoting.Weak };
        const task = createShellTask(m.vscode, {
            command: [quoted],
            name: 'Example task',
        });

        const execution = task.execution as vscode.ShellExecution;
        expect(execution.command).to.deep.equal(quoted);
    });

    it('quotes an unresolvable unquoted path that contains spaces', () => {
        const m = createMockVsCode();

        const task = createShellTask(m.vscode, {
            command: ['./my scripts/deploy.ps1'],
            name: 'Example task',
        });

        const execution = task.execution as vscode.ShellExecution;
        expect(execution.command).to.deep.equal({ value: './my scripts/deploy.ps1', quoting: ShellQuoting.Strong });
    });

    it('rejects an empty command line', () => {
        const m = createMockVsCode();

        expect(() => createShellTask(m.vscode, {
            command: [],
            name: 'Example task',
        })).to.throw(/A command line must include at least the executable/);
    });

    it('rejects a quoted empty executable', () => {
        const m = createMockVsCode();

        expect(() => createShellTask(m.vscode, {
            command: [{ value: '', quoting: ShellQuoting.Strong }],
            name: 'Example task',
        })).to.throw(/A command line must include at least the executable/);
    });

    it('resolves the executable against the caller-supplied PATH', async () => {
        const m = createMockVsCode();
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shell-task-path-'));
        try {
            const extension = process.platform === 'win32' ? '.cmd' : '';
            const target = path.join(directory, `pathtool${extension}`);
            await fs.writeFile(target, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n', { mode: 0o755 });

            // The name is absent from the real PATH, so this only succeeds if
            // the override is honored.
            const task = createShellTask(m.vscode, {
                command: ['pathtool'],
                name: 'Example task',
                env: { PATH: directory },
            });

            const execution = task.execution as vscode.ShellExecution;
            expect(execution.command).to.deep.equal({ value: target, quoting: ShellQuoting.Strong });
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    it('lets a differently-cased PATH override replace the inherited one', async function () {
        // Windows environment names are case-insensitive, so `Path` must
        // replace `PATH` rather than producing an ambiguous environment.
        if (process.platform !== 'win32') {
            this.skip();
        }

        const m = createMockVsCode();
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shell-task-case-'));
        try {
            const target = path.join(directory, 'casetool.cmd');
            await fs.writeFile(target, '@echo off\r\n');

            const task = createShellTask(m.vscode, {
                command: ['casetool'],
                name: 'Example task',
                env: { Path: directory },
            });

            const execution = task.execution as vscode.ShellExecution;
            expect(execution.command).to.deep.equal({ value: target, quoting: ShellQuoting.Strong });
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    it('does not hand a bare name to the shell when only the working directory has a match', async function () {
        // cmd.exe searches the working directory before PATH, so passing the
        // bare name through would let a planted binary run.
        if (process.platform !== 'win32') {
            this.skip();
        }

        const m = createMockVsCode();
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shell-task-'));
        try {
            await fs.writeFile(path.join(directory, 'planted-tool.cmd'), '@echo off\r\n');

            expect(() => createShellTask(m.vscode, {
                command: ['planted-tool'],
                name: 'Example task',
                cwd: m.vscode.Uri.file(directory),
            })).to.throw(/could not be found on PATH/);
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    it('does not rewrite an explicit relative path to one under this process\'s directory', async () => {
        // The task runs in the shell's working directory, not this process's, so
        // resolving the caller's relative path here could name a different file.
        const m = createMockVsCode();
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shell-task-'));
        const originalCwd = process.cwd();
        try {
            // A real executable, so resolution would genuinely succeed.
            const planted = path.join(directory, `planted${path.extname(process.execPath)}`);
            await fs.copyFile(process.execPath, planted);
            process.chdir(directory);

            const relative = `./${path.basename(planted)}`;
            const task = createShellTask(m.vscode, {
                command: [relative],
                name: 'Example task',
            });

            const execution = task.execution as vscode.ShellExecution;
            expect(execution.command).to.equal(relative);
        } finally {
            process.chdir(originalCwd);
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    it('rejects an executable containing a shell command separator', () => {
        // A newline would otherwise reach the shell as a second command.
        const m = createMockVsCode();

        expect(() => createShellTask(m.vscode, {
            command: ['./tool\nwhoami'],
            name: 'Example task',
        })).to.throw();
    });
});
