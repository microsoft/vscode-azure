/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode, type IVsCode as VsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { getStaticWebAppBuildPreset } from '../../commands/staticWebApps/buildPresets';
import { detectStaticWebAppProject } from '../../commands/staticWebApps/steps/frameworkDetection';
import { getFolderContainingDatabaseConfig } from '../../staticWebApps/DatabaseConfigDetector';
import {
    FunctionsEmulatorAddress,
    SwaCliCommand,
} from '../../staticWebApps/SwaCliService';
import { tryGetStaticWebAppsCliConfig } from '../../staticWebApps/SwaCliConfig';

/** Source assigned to all generated Static Web Apps tasks. */
export const SwaTaskSource = 'swa';
/** Problem matcher supplied by the following manifest slice. */
export const SwaWatchProblemMatcher = '$swa-watch';

/**
 * Generates SWA CLI tasks from `swa-cli.config.json` and retained framework detection.
 *
 * Tasks remain scoped to their originating workspace folder and duplicate labels
 * within a folder are removed deterministically.
 */
@injectable()
export class SwaTaskProvider implements vscode.TaskProvider {
    public constructor(
        @inject(IVsCode) private readonly code: VsCode,
    ) { }

    /** Generated tasks are authoritative and are not resolved from persisted definitions. */
    public resolveTask(): undefined {
        return undefined;
    }

    /** @inheritdoc */
    public async provideTasks(): Promise<vscode.Task[]> {
        const tasks: vscode.Task[] = [];
        for (const workspaceFolder of this.code.workspace.workspaceFolders ?? []) {
            tasks.push(...await this.provideTasksForWorkspaceFolder(workspaceFolder));
        }
        return tasks;
    }

    /** Generates tasks for one workspace folder, primarily for focused tests. */
    public async provideTasksForWorkspaceFolder(
        workspaceFolder: vscode.WorkspaceFolder,
    ): Promise<vscode.Task[]> {
        const tasks = [
            ...await this.getConfigTasks(workspaceFolder),
            ...await this.getDetectedTasks(workspaceFolder),
        ];
        const uniqueTasks = new Map<string, vscode.Task>();
        for (const task of tasks) {
            const label = `${task.source}: ${task.name}`;
            if (!uniqueTasks.has(label)) {
                uniqueTasks.set(label, task);
            }
        }
        return [...uniqueTasks.values()];
    }

    private async getConfigTasks(workspaceFolder: vscode.WorkspaceFolder): Promise<vscode.Task[]> {
        const config = await tryGetStaticWebAppsCliConfig(this.code, workspaceFolder.uri);
        const names = Object.keys(config?.configurations ?? {});
        const tasks = names.map(name => this.createTask(workspaceFolder, `start ${name}`, ['start', name]));
        if (names.length === 1) {
            tasks.push(this.createTask(workspaceFolder, 'start', ['start']));
        }
        return tasks;
    }

    private async getDetectedTasks(workspaceFolder: vscode.WorkspaceFolder): Promise<vscode.Task[]> {
        const detection = await detectStaticWebAppProject(this.code, workspaceFolder.uri);
        if (!detection.primaryPresetId || !detection.appLocation) {
            return [];
        }

        const preset = getStaticWebAppBuildPreset(detection.primaryPresetId);
        const appLocation = detection.appLocation;
        const appName = getDetectedAppName(workspaceFolder, appLocation);
        const databaseConfigFolder = await getFolderContainingDatabaseConfig(this.code, workspaceFolder.uri);
        const args = [
            'start',
            `http://localhost:${preset.port}`,
            '--app-location',
            appLocation,
            ...(detection.apiLocations.length > 0
                ? ['--api-location', FunctionsEmulatorAddress]
                : []),
            '--run',
            preset.startCommand ?? 'npm start',
            ...(databaseConfigFolder
                ? ['--data-api-location', databaseConfigFolder.fsPath]
                : []),
            '--devserver-timeout=90000',
        ];
        return [this.createTask(
            workspaceFolder,
            `start ${appName}`,
            args,
            { BROWSER: 'none' },
        )];
    }

    private createTask(
        workspaceFolder: vscode.WorkspaceFolder,
        name: string,
        args: readonly string[],
        env?: Readonly<Record<string, string>>,
    ): vscode.Task {
        const execution = new this.code.ShellExecution(
            SwaCliCommand,
            [...args],
            env ? { env: { ...env } } : undefined,
        );
        const task = new this.code.Task(
            { type: 'shell' },
            workspaceFolder,
            name,
            SwaTaskSource,
            execution,
            SwaWatchProblemMatcher,
        );
        task.isBackground = true;
        return task;
    }
}

function getDetectedAppName(
    workspaceFolder: vscode.WorkspaceFolder,
    appLocation: string,
): string {
    const segments = appLocation.replace(/\\/g, '/').split('/').filter(Boolean);
    return segments.pop() ?? workspaceFolder.name;
}
