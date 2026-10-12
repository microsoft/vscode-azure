/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, dirname, Disposable, ExternalError, IActionExecutor, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { FunctionsHostFileTag } from '../../tree/workspace/functions/FunctionsWorkspaceDataProvider';
import { IWorkspaceIndexService } from '../../utils/workspaceIndex/WorkspaceIndexService';
import { FunctionsProjectSelector } from '../FunctionsProjectSelector';
import { LocalFunctionSettings } from '../LocalFunctionSettings';
import { LocalFunctionsHostProcess } from '../host/LocalFunctionsHostProcess';
import { FunctionsDebugPreparation } from './FunctionsDebugPreparation';

/** Resolves the product debugger to a language attach configuration after VS Code runs preLaunchTask and substitutes variables. */
@injectable()
export class FunctionsDebugProvider implements vscode.DebugConfigurationProvider, Disposable {
    public static readonly Type = 'azure-functions';
    private readonly subscriptions: Disposable[] = [];

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly actions: IActionExecutor,
        @inject(IWorkspaceIndexService) private readonly index: IWorkspaceIndexService,
        @inject(FunctionsProjectSelector) private readonly projects: FunctionsProjectSelector,
        @inject(FunctionsDebugPreparation) private readonly preparation: FunctionsDebugPreparation,
        @inject(LocalFunctionsHostProcess) private readonly hosts: LocalFunctionsHostProcess,
        @inject(LocalFunctionSettings) private readonly settings: LocalFunctionSettings,
    ) { }

    /** Registers only provider/adapter lifecycle hooks; activation never acquires tools or starts a host. */
    public register(): void {
        for (const trigger of [this.code.DebugConfigurationProviderTriggerKind.Initial, this.code.DebugConfigurationProviderTriggerKind.Dynamic]) {
            this.subscriptions.push(this.code.debug.registerDebugConfigurationProvider(FunctionsDebugProvider.Type, this, trigger));
        }
        const stop = (session: vscode.DebugSession) => {
            const id: unknown = session.configuration.__azureFunctionsHostId;
            if (typeof id === 'string') {
                void this.hosts.stop(id).catch(() => {
                    void this.code.window.showErrorMessage(this.code.l10n.t('Could not finish stopping the Functions host.'));
                });
            }
        };
        this.subscriptions.push(this.code.debug.onDidTerminateDebugSession(stop));
        this.subscriptions.push(this.code.debug.registerDebugAdapterTrackerFactory('*', {
            createDebugAdapterTracker: session => typeof session.configuration.__azureFunctionsHostId === 'string'
                ? { onError: () => { stop(session); }, onExit: () => { stop(session); } } : undefined,
        }));
    }

    public async provideDebugConfigurations(folder?: vscode.WorkspaceFolder): Promise<vscode.DebugConfiguration[]> {
        return (await this.index.getIndex()).withTag(FunctionsHostFileTag)
            .filter(uri => !folder || this.code.workspace.getWorkspaceFolder(uri)?.uri.toString() === folder.uri.toString())
            .map(uri => ({
                type: FunctionsDebugProvider.Type, request: 'launch',
                name: this.code.l10n.t('Debug Functions: {0}', dirname(uri).fsPath), projectPath: dirname(uri).fsPath,
            }));
    }

    public resolveDebugConfiguration(_folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): vscode.DebugConfiguration {
        return { ...config, type: FunctionsDebugProvider.Type, request: 'launch', name: config.name || this.code.l10n.t('Debug Azure Functions') };
    }

    public async resolveDebugConfigurationWithSubstitutedVariables(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): Promise<vscode.DebugConfiguration | undefined> {
        return this.actions.callWithTelemetryAndErrorHandling('functions/debug', async () => {
            if (token?.isCancellationRequested) { throw new CancellationError(); }
            const path: unknown = config.projectPath;
            if (path !== undefined && (typeof path !== 'string' || !path.trim())) {
                throw new ExternalError(this.code.l10n.t('projectPath must be a filesystem path.'));
            }
            const project = await this.projects.select(folder, path);
            const env = stringRecord(config.env, this.code);
            if (Object.keys(env).some(key => /^(?:languageWorkers__.*__(?:arguments|defaultExecutablePath)|PSWorkerCustomPipeName|FUNCTIONS_WORKER_PROCESS_COUNT)$/i.test(key))) {
                throw new ExternalError(this.code.l10n.t('env cannot override the owned worker debugger or process settings. Use debugPort instead.'));
            }
            const args: unknown = config.hostArgs;
            if (args !== undefined && (!Array.isArray(args) || !args.every(arg => typeof arg === 'string'))) {
                throw new ExternalError(this.code.l10n.t('hostArgs must be an array of strings.'));
            }
            const hostArgs: string[] = Array.isArray(args) ? args : [];
            if (hostArgs.some(arg => /^(?:-p|-t|--(?:port|address|useHttps|enableAuth|language-worker|runtime|dotnet-isolated-debug|enable-json-output|json-output-file|no-build))(?:=|$)/i.test(arg))) {
                throw new ExternalError(this.code.l10n.t('hostArgs cannot override the owned host transport, runtime, or debugger options. Use hostPort, debugPort, or skipBuild instead.'));
            }
            const hostPort = portOption(config.hostPort, this.code);
            const debugPort = portOption(config.debugPort, this.code);
            const runtime = await this.preparation.validate(project, env);
            const executable = await this.preparation.executable(project, token);
            const cwd = config.skipBuild === true || config.preLaunchTask
                ? await this.preparation.hostDirectory(project, runtime)
                : await this.preparation.build(project, runtime, env, token);
            const host = await this.hosts.start({
                project, cwd, runtime, executable, hostPort, debugPort, hostArgs,
                prepare: async (port, pipe) => {
                    const projectEnv = Object.fromEntries(Object.entries({ ...(await this.settings.read(project)).values, ...env })
                        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
                    return {
                        ...projectEnv, ...await this.preparation.workerEnvironment(project, runtime, port, pipe, projectEnv),
                        ['FUNCTIONS_WORKER_RUNTIME']: runtime, ['FUNCTIONS_WORKER_PROCESS_COUNT']: '1',
                    };
                },
            }, token);
            const postDebugTask: unknown = config.postDebugTask;
            const presentation: unknown = config.presentation;
            const internalConsoleOptions: unknown = config.internalConsoleOptions;
            const common = {
                name: config.name, request: 'attach', ['__azureFunctionsHostId']: host.id,
                postDebugTask, presentation, internalConsoleOptions,
            };
            if (runtime === 'node') { return { ...common, type: 'pwa-node', address: '127.0.0.1', port: host.debugPort, localRoot: project.fsPath }; }
            if (runtime === 'python') { return { ...common, type: 'debugpy', connect: { host: '127.0.0.1', port: host.debugPort }, justMyCode: true }; }
            if (runtime === 'java') { return { ...common, type: 'java', hostName: '127.0.0.1', port: host.debugPort }; }
            if (runtime === 'powershell') { return { ...common, type: 'PowerShell', customPipeName: host.pipe, runspaceId: 1 }; }
            return { ...common, type: 'coreclr', processId: String(host.workerPid), justMyCode: true };
        });
    }

    public dispose(): void {
        this.subscriptions.splice(0).forEach(disposable => { disposable.dispose(); });
    }
}

function stringRecord(value: unknown, code: IVsCode): Readonly<Record<string, string>> {
    if (value === undefined) { return {}; }
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.values(value).every(entry => typeof entry === 'string')) {
        throw new ExternalError(code.l10n.t('env must contain string-valued environment variables.'));
    }
    return value as Readonly<Record<string, string>>;
}

function portOption(value: unknown, code: IVsCode): number | undefined {
    if (value === undefined) { return undefined; }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
        throw new ExternalError(code.l10n.t('A configured port must be an integer from 1 to 65535.'));
    }
    return value;
}
