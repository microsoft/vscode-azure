/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import type * as vscode from 'vscode';
import { SwaTaskProvider } from '../../src/tasks/staticWebApps/SwaTaskProvider';

describe('SwaTaskProvider (unit)', () => {
    it('should generate config and detected tasks with exact SWA arguments', async () => {
        const mockResult = createMockVsCode();
        const root = mockResult.vscode.Uri.file('/workspace');
        const folder = { uri: root, name: 'workspace', index: 0 } as vscode.WorkspaceFolder;
        mockResult.workspaceFolders.push(folder);
        mockResult.fs.addFile(
            mockResult.vscode.Uri.joinPath(root, 'swa-cli.config.json'),
            JSON.stringify({ configurations: { app: {} } }),
        );
        mockResult.fs.addFile(
            mockResult.vscode.Uri.joinPath(root, 'package.json'),
            JSON.stringify({ dependencies: { react: '19.0.0' }, scripts: { start: 'react-scripts start' } }),
        );
        mockResult.fs.addFile(mockResult.vscode.Uri.joinPath(root, 'api', 'host.json'), '{}');
        mockResult.fs.addFile(
            mockResult.vscode.Uri.joinPath(root, 'data', 'staticwebapp.database.config.json'),
            '{}',
        );

        const tasks = await new SwaTaskProvider(mockResult.vscode)
            .provideTasksForWorkspaceFolder(folder);

        expect(tasks.map(task => `${task.source}: ${task.name}`)).to.deep.equal([
            'swa: start app',
            'swa: start',
            'swa: start workspace',
        ]);
        const detected = tasks[2];
        const execution = detected.execution as vscode.ShellExecution;
        expect(execution.command).to.equal('swa');
        expect(execution.args).to.deep.equal([
            'start',
            'http://localhost:3000',
            '--app-location',
            '/',
            '--api-location',
            'http://localhost:7071',
            '--run',
            'npm start',
            '--data-api-location',
            mockResult.vscode.Uri.joinPath(root, 'data').fsPath,
            '--devserver-timeout=90000',
        ]);
        expect(execution.options?.env).to.deep.equal({ BROWSER: 'none' });
        expect(detected.definition).to.deep.equal({ type: 'shell' });
        expect(detected.problemMatchers).to.deep.equal(['$swa-watch']);
        expect(detected.isBackground).to.equal(true);
        expect(detected.scope).to.equal(folder);
    });

    it('should avoid duplicate task labels within a workspace', async () => {
        const mockResult = createMockVsCode();
        const root = mockResult.vscode.Uri.file('/workspace/app');
        const folder = { uri: root, name: 'app', index: 0 } as vscode.WorkspaceFolder;
        mockResult.fs.addFile(
            mockResult.vscode.Uri.joinPath(root, 'swa-cli.config.json'),
            JSON.stringify({ configurations: { app: {} } }),
        );
        mockResult.fs.addFile(
            mockResult.vscode.Uri.joinPath(root, 'package.json'),
            JSON.stringify({ dependencies: { react: '19.0.0' } }),
        );

        const tasks = await new SwaTaskProvider(mockResult.vscode)
            .provideTasksForWorkspaceFolder(folder);

        expect(tasks.filter(task => task.name === 'start app')).to.have.lengthOf(1);
    });
});
