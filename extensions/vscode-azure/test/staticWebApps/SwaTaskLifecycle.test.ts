/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { getSwaTaskScopeKey, SwaTaskLifecycle } from '../../src/tasks/staticWebApps/SwaTaskLifecycle';

describe('SwaTaskLifecycle (unit)', () => {
    it('should match only workspace-scoped SWA shell tasks', () => {
        const mockResult = createMockVsCode();
        const folder = {
            uri: mockResult.vscode.Uri.file('/workspace'),
            name: 'workspace',
            index: 0,
        } as vscode.WorkspaceFolder;
        const swaTask = new mockResult.vscode.Task(
            { type: 'shell' },
            folder,
            'start workspace',
            'swa',
            new mockResult.vscode.ShellExecution('swa', ['start']),
        );
        const otherTask = new mockResult.vscode.Task(
            { type: 'shell' },
            folder,
            'other',
            'npm',
            new mockResult.vscode.ShellExecution('npm', ['start']),
        );

        expect(getSwaTaskScopeKey(mockResult.vscode, swaTask)).to.equal(
            `folder:${folder.uri.toString()}`,
        );
        expect(getSwaTaskScopeKey(mockResult.vscode, otherTask)).to.equal(undefined);
    });

    it('should stop the tracked process only for a top-level linked debug termination', () => {
        const mockResult = createMockVsCode();
        const folder = {
            uri: mockResult.vscode.Uri.file('/workspace'),
            name: 'workspace',
            index: 0,
        } as vscode.WorkspaceFolder;
        const task = new mockResult.vscode.Task(
            { type: 'shell' },
            folder,
            'start workspace',
            'swa',
            new mockResult.vscode.ShellExecution('swa', ['start']),
        );
        const execution = { task } as vscode.TaskExecution;
        const stop = mock.fn();
        const lifecycle = new SwaTaskLifecycle(
            mockResult.vscode,
            { stop },
        );

        mockResult.taskProcessStartEmitter.fire({ execution, processId: 1234 });
        mockResult.debugSessionTerminateEmitter.fire({
            workspaceFolder: folder,
            parentSession: {} as vscode.DebugSession,
        } as vscode.DebugSession);
        expect(stop.mock.callCount()).to.equal(0);

        mockResult.debugSessionTerminateEmitter.fire({
            workspaceFolder: folder,
            parentSession: undefined,
        } as unknown as vscode.DebugSession);
        expect(stop.mock.callCount()).to.equal(1);
        expect(stop.mock.calls[0].arguments[0]).to.equal(1234);

        mockResult.debugSessionTerminateEmitter.fire({
            workspaceFolder: folder,
        } as vscode.DebugSession);
        expect(stop.mock.callCount()).to.equal(1);
        lifecycle.dispose();
    });
});
