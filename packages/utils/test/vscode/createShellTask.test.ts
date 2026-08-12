/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import type * as vscode from 'vscode';
import { ShellQuoting, command } from '../../src/base/CommandLineBuilder';
import { createShellTask } from '../../src/vscode/createShellTask';
import { createMockVsCode } from './MockVsCode';

describe('createShellTask (unit)', () => {
    it('builds a configured task from a structured command line', async () => {
        const m = createMockVsCode();
        const workspaceFolder: vscode.WorkspaceFolder = {
            uri: m.vscode.Uri.file('workspace'),
            name: 'workspace',
            index: 0,
        };
        const definition = { type: 'example', id: 'task' };
        const cwd = m.vscode.Uri.file('cwd');

        const task = await createShellTask(m.vscode, {
            command: command(process.execPath)
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
        expect(execution.command).to.equal(process.execPath);
        expect(execution.args).to.deep.equal([
            'plain',
            { value: 'quoted value', quoting: ShellQuoting.Strong },
        ]);
        expect(execution.options).to.deep.equal({
            cwd: cwd.fsPath,
            env: { EXAMPLE: 'value' },
        });
    });

    it('uses process-task defaults', async () => {
        const m = createMockVsCode();

        const task = await createShellTask(m.vscode, {
            command: [process.execPath],
            name: 'Example task',
        });

        expect(task.definition).to.deep.equal({ type: 'shell' });
        expect(task.scope).to.equal(m.vscode.TaskScope.Workspace);
        expect(task.source).to.equal('process');
        expect(task.isBackground).to.equal(false);
    });

    it('rejects an empty command line', async () => {
        const m = createMockVsCode();

        await expect(createShellTask(m.vscode, {
            command: [],
            name: 'Example task',
        })).to.be.rejectedWith(/A command line must include at least the executable/);
    });
});
