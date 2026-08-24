/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    IOutputChannel,
    IVsCode,
    stringifyError,
    type Disposable,
    type IOutputChannel as OutputChannel,
    type IVsCode as VsCode,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { IProcessTerminator } from '../../utils/ProcessTerminator';
import { SwaTaskSource } from './SwaTaskProvider';

/**
 * Tracks generated SWA task process IDs and stops only the process linked to a
 * terminating top-level debug session. Task termination is deliberately avoided
 * because it closes the terminal and discards useful emulator output.
 */
@injectable()
export class SwaTaskLifecycle implements Disposable {
    private readonly runningProcesses = new Map<string, number>();
    private readonly disposables: vscode.Disposable[];

    public constructor(
        @inject(IVsCode) private readonly code: VsCode,
        @inject(IProcessTerminator) private readonly processTerminator: IProcessTerminator,
        @inject(IOutputChannel) private readonly output: OutputChannel,
    ) {
        this.disposables = [
            this.code.tasks.onDidStartTaskProcess(event => {
                this.trackStartedTask(event);
            }),
            this.code.tasks.onDidEndTaskProcess(event => {
                this.forgetEndedTask(event);
            }),
            this.code.debug.onDidTerminateDebugSession(session => {
                this.handleDebugTermination(session);
            }),
        ];
    }

    /** @inheritdoc */
    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.runningProcesses.clear();
    }

    private trackStartedTask(event: vscode.TaskProcessStartEvent): void {
        const key = getSwaTaskScopeKey(this.code, event.execution.task);
        if (key) {
            this.runningProcesses.set(key, event.processId);
        }
    }

    private forgetEndedTask(event: vscode.TaskProcessEndEvent): void {
        const key = getSwaTaskScopeKey(this.code, event.execution.task);
        if (key) {
            this.runningProcesses.delete(key);
        }
    }

    private handleDebugTermination(session: vscode.DebugSession): void {
        if (session.parentSession || !session.workspaceFolder) {
            return;
        }

        const key = workspaceFolderScopeKey(session.workspaceFolder);
        const processId = this.runningProcesses.get(key);
        if (processId === undefined) {
            return;
        }

        this.runningProcesses.delete(key);
        this.processTerminator.stop(processId).catch((error: unknown) => {
            // Leaves the emulator running rather than the debug session hanging: the user
            // can still stop the task from its terminal.
            this.output.debug(`[swa] could not stop process ${processId}: ${stringifyError(error)}`);
        });
    }
}

/**
 * Returns the tracking key for a generated SWA shell task, or `undefined` for
 * unrelated tasks.
 */
export function getSwaTaskScopeKey(code: VsCode, task: vscode.Task): string | undefined {
    // Matched on the definition rather than the command: createShellTask pins a
    // bare name to its absolute path on PATH, so a generated task's command is
    // no longer the literal name it was built from.
    if (task.source !== SwaTaskSource
        || !(task.execution instanceof code.ShellExecution)
        || task.definition.swaCli !== true
        || task.scope === undefined) {
        return undefined;
    }

    return typeof task.scope === 'number'
        ? `scope:${task.scope}`
        : workspaceFolderScopeKey(task.scope);
}

function workspaceFolderScopeKey(folder: vscode.WorkspaceFolder): string {
    return `folder:${folder.uri.toString()}`;
}

