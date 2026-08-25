/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import * as vscode from 'vscode';
import { staticWebAppDatabaseDetector } from '../../src/staticWebApps/DatabaseConfigDetector';
import { createTestIndexService } from '../utils/workspaceIndex/createTestIndexService';
import { SwaTaskDefinition, SwaTaskProvider } from '../../src/tasks/staticWebApps/SwaTaskProvider';
import { withNpxOnPath } from './npxOnPath';

describe('SwaTaskProvider (unit)', () => {
    it('should generate config and detected tasks with exact SWA arguments', async () => { await withNpxOnPath(async executablePath => {
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
        const sendTelemetryErrorEvent = mock.fn();
        const { executor } = createTestActionExecutor({
            reporter: {
                sendTelemetryErrorEvent,
                dispose: () => Promise.resolve(),
            },
        });

        const tasks = await new SwaTaskProvider(mockResult.vscode, executor, createTestIndexService(mockResult.vscode, [staticWebAppDatabaseDetector]))
            .provideTasksForWorkspaceFolder(folder);

        expect(tasks.map(task => `${task.source}: ${task.name}`)).to.deep.equal([
            'swa: start app',
            'swa: start',
            'swa: start workspace',
        ]);
        const detected = tasks[2];
        const execution = detected.execution as vscode.ShellExecution;
        // A bare name is pinned to the absolute path it resolves to on PATH, so a
        // same-named binary in the working directory cannot be run instead. The
        // path is strongly quoted because it may contain spaces.
        expect(execution.command).to.deep.equal({ value: executablePath, quoting: vscode.ShellQuoting.Strong });
        expect(execution.args).to.deep.equal([
            '-y',
            '@azure/static-web-apps-cli@latest',
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
        expect(detected.definition).to.deep.equal(SwaTaskDefinition);
        expect(detected.problemMatchers).to.deep.equal(['$swa-watch']);
        expect(detected.isBackground).to.equal(true);
        expect(detected.scope).to.equal(folder);
        expect(sendTelemetryErrorEvent.mock.calls[0].arguments[0])
            .to.equal('staticWebApps.provideTasksForWorkspaceFolder');
        expect(sendTelemetryErrorEvent.mock.calls[0].arguments[1]).to.include({
            hasSwaCliConfig: 'true',
            isActivationEvent: 'true',
            result: 'Succeeded',
        });
        expect(sendTelemetryErrorEvent.mock.calls[0].arguments[2]).to.include({
            configCount: 2,
            detectedCount: 1,
            taskCount: 3,
        });
    }); });

    it('should report no tasks when the SWA CLI is not on PATH', async () => {
        // The CLI is installed on demand, so a task naming it could only fail in
        // the terminal until then. Discovery runs again after the debug flow has
        // prompted the user to install, which is when the tasks appear.
        const mockResult = createMockVsCode();
        const root = mockResult.vscode.Uri.file('/workspace');
        const folder = { uri: root, name: 'workspace', index: 0 } as vscode.WorkspaceFolder;
        mockResult.workspaceFolders.push(folder);
        mockResult.fs.addFile(
            mockResult.vscode.Uri.joinPath(root, 'swa-cli.config.json'),
            JSON.stringify({ configurations: { app: {} } }),
        );
        const { executor } = createTestActionExecutor();

        const originalPath = process.env.PATH;
        process.env.PATH = '';
        try {
            const tasks = await new SwaTaskProvider(mockResult.vscode, executor, createTestIndexService(mockResult.vscode, [staticWebAppDatabaseDetector]))
                .provideTasksForWorkspaceFolder(folder);
            expect(tasks).to.have.lengthOf(0);
        } finally {
            process.env.PATH = originalPath;
        }
    });

    it('should avoid duplicate task labels within a workspace', async () => { await withNpxOnPath(async () => {
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
        const { executor } = createTestActionExecutor();

        const tasks = await new SwaTaskProvider(mockResult.vscode, executor, createTestIndexService(mockResult.vscode, [staticWebAppDatabaseDetector]))
            .provideTasksForWorkspaceFolder(folder);

        expect(tasks.filter(task => task.name === 'start app')).to.have.lengthOf(1);
    }); });

    it('should report aggregate task discovery without nested folder events', async () => { await withNpxOnPath(async () => {
        const mockResult = createMockVsCode();
        const root = mockResult.vscode.Uri.file('/workspace');
        const folder = { uri: root, name: 'workspace', index: 0 } as vscode.WorkspaceFolder;
        mockResult.workspaceFolders.push(folder);
        mockResult.fs.addFile(
            mockResult.vscode.Uri.joinPath(root, 'swa-cli.config.json'),
            JSON.stringify({ configurations: { app: {} } }),
        );
        const sendTelemetryErrorEvent = mock.fn();
        const { executor } = createTestActionExecutor({
            reporter: {
                sendTelemetryErrorEvent,
                dispose: () => Promise.resolve(),
            },
        });

        const tasks = await new SwaTaskProvider(mockResult.vscode, executor, createTestIndexService(mockResult.vscode, [staticWebAppDatabaseDetector])).provideTasks();

        expect(tasks).to.have.lengthOf(2);
        expect(sendTelemetryErrorEvent.mock.callCount()).to.equal(1);
        expect(sendTelemetryErrorEvent.mock.calls[0].arguments[0]).to.equal('staticWebApps.provideTasks');
        expect(sendTelemetryErrorEvent.mock.calls[0].arguments[2]).to.include({
            workspaceFolderCount: 1,
            detectedCount: 2,
            configTaskCount: 2,
            detectedTaskCount: 0,
        });
    }); });
});
