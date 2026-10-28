/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { dirname, Disposable, ExternalError, IActionExecutor, IVsCode, throwIfCancelled } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import * as z from 'zod/mini';
import { FunctionsHostFileTag } from '../functionsDetector';
import { IWorkspaceIndexService } from '../../utils/workspaceIndex/WorkspaceIndexService';
import { FunctionsProjectSelector } from '../FunctionsProjectSelector';
import { LocalFunctionsHostProcess, type FunctionsHostAttachment } from '../host/LocalFunctionsHostProcess';
import { FunctionsDebugPreparation } from './FunctionsDebugPreparation';
import { FunctionsDebugType, type FunctionsDebugRuntime } from './functionsDebug';

const ProtectedHostOptions = new Set([
    '-p', '-t', '-v', '--port', '--address', '--usehttps', '--enableauth', '--enable-auth',
    '--language-worker', '--runtime', '--host-version', '--profile', '--dotnet-isolated-debug',
    '--enable-json-output', '--json-output-file', '--no-build', '--output', '--no-tui',
]);

/** Resolves the product debugger to a language attach configuration after VS Code runs preLaunchTask and substitutes variables. */
@injectable()
export class FunctionsDebugProvider implements vscode.DebugConfigurationProvider, Disposable {
    private readonly subscriptions: Disposable[] = [];

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly actions: IActionExecutor,
        @inject(IWorkspaceIndexService) private readonly index: IWorkspaceIndexService,
        @inject(FunctionsProjectSelector) private readonly projects: FunctionsProjectSelector,
        @inject(FunctionsDebugPreparation) private readonly preparation: FunctionsDebugPreparation,
        @inject(LocalFunctionsHostProcess) private readonly hosts: LocalFunctionsHostProcess,
    ) { }

    /** Registers only provider/adapter lifecycle hooks; activation never acquires tools or starts a host. */
    public register(): void {
        const { Initial, Dynamic } = this.code.DebugConfigurationProviderTriggerKind;
        // The resolve hooks are registered without provideDebugConfigurations so a generated launch.json keeps only the
        // portable static configuration; per-project configurations are offered by the dynamic registration below.
        this.subscriptions.push(this.code.debug.registerDebugConfigurationProvider(FunctionsDebugType, {
            resolveDebugConfiguration: (folder, config) => this.resolveDebugConfiguration(folder, config),
            resolveDebugConfigurationWithSubstitutedVariables: (folder, config, token) =>
                this.resolveDebugConfigurationWithSubstitutedVariables(folder, config, token),
        }, Initial));
        // VS Code runs resolve hooks for every registration, so the dynamic one only supplies configurations.
        this.subscriptions.push(this.code.debug.registerDebugConfigurationProvider(FunctionsDebugType, {
            provideDebugConfigurations: folder => this.provideDebugConfigurations(folder),
        }, Dynamic));
        const stop = (session: vscode.DebugSession) => {
            const id: unknown = session.configuration.__azureFunctionsHostId;
            if (typeof id === 'string') {
                void this.hosts.stop(id).catch(() => {
                    void this.code.window.showErrorMessage(this.code.l10n.t('Could not finish stopping the Functions host.'));
                });
            }
        };
        this.subscriptions.push(this.code.debug.onDidTerminateDebugSession(session => { stop(session); }));
        this.subscriptions.push(this.code.debug.registerDebugAdapterTrackerFactory('*', {
            createDebugAdapterTracker: session => typeof session.configuration.__azureFunctionsHostId === 'string'
                ? { onError: () => { stop(session); }, onExit: () => { stop(session); } } : undefined,
        }));
    }

    public async provideDebugConfigurations(folder?: vscode.WorkspaceFolder): Promise<vscode.DebugConfiguration[]> {
        return (await this.index.getIndex()).withTag(FunctionsHostFileTag)
            .filter(uri => !folder || this.code.workspace.getWorkspaceFolder(uri)?.uri.toString() === folder.uri.toString())
            .map(uri => ({
                type: FunctionsDebugType, request: 'launch',
                name: this.code.l10n.t('Debug Functions: {0}', dirname(uri).fsPath), projectPath: dirname(uri).fsPath,
            }));
    }

    public resolveDebugConfiguration(_folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): vscode.DebugConfiguration {
        return { ...config, type: FunctionsDebugType, request: 'launch', name: config.name || this.code.l10n.t('Debug Azure Functions') };
    }

    public async resolveDebugConfigurationWithSubstitutedVariables(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): Promise<vscode.DebugConfiguration | undefined> {
        return this.actions.callWithTelemetryAndErrorHandling('functions/debug', async () => {
            throwIfCancelled(token);
            const path = parseOption(ProjectPathSchema, config.projectPath, this.code.l10n.t('projectPath must be a filesystem path.'));
            const project = await this.projects.select(folder, path);
            const env = parseOption(EnvSchema, config.env, this.code.l10n.t('env must contain string-valued environment variables.')) ?? {};
            if (Object.keys(env).some(isOwnedWorkerSetting)) {
                throw new ExternalError(this.code.l10n.t('env cannot override the owned worker debugger or process settings. Use debugPort instead.'));
            }
            const hostArgs = parseOption(HostArgsSchema, config.hostArgs, this.code.l10n.t('hostArgs must be an array of strings.')) ?? [];
            if (hostArgs.some(arg => ProtectedHostOptions.has(arg.split('=', 1)[0].toLowerCase()))) {
                throw new ExternalError(this.code.l10n.t('hostArgs cannot override the owned host transport, runtime, or debugger options. Use hostPort, debugPort, or skipBuild instead.'));
            }
            const portMessage = this.code.l10n.t('A configured port must be an integer from 1 to 65535.');
            const hostPort = parseOption(PortSchema, config.hostPort, portMessage);
            const debugPort = parseOption(PortSchema, config.debugPort, portMessage);
            const launch = await this.preparation.prepare(project, env, token);
            const executable = await this.preparation.executable(project, token);
            await this.preparation.ensureWorkloads(project, executable, token);
            const skipBuild = config.skipBuild === true || !!config.preLaunchTask;
            if (launch.runtime === 'native' && !skipBuild) {
                await this.preparation.buildGo(launch, token);
            }
            const host = await this.hosts.start({
                project, runtime: launch.runtime, executable, hostPort, debugPort, hostArgs,
                skipBuild: skipBuild || launch.runtime === 'native',
                prepare: (port, pipe) => this.preparation.workerEnvironment(launch, port, pipe),
            }, token);
            // The language debugger runs as its own session so VS Code resolves its configuration with that
            // debugger's resolvers. Returning undefined ends this session without a message.
            let started = false;
            try {
                started = await this.code.debug.startDebugging(
                    this.code.workspace.getWorkspaceFolder(project) ?? folder,
                    attachConfiguration(config, launch.runtime, project, host),
                );
            } finally {
                if (!started) {
                    await this.hosts.stop(host.id).catch(() => undefined);
                }
            }
            if (!started) {
                throw new ExternalError(this.code.l10n.t('Could not start the language debugger for the Functions host.'));
            }
            return undefined;
        });
    }

    public dispose(): void {
        this.subscriptions.splice(0).forEach(disposable => { disposable.dispose(); });
    }
}

function attachConfiguration(config: vscode.DebugConfiguration, runtime: FunctionsDebugRuntime, project: vscode.Uri, host: FunctionsHostAttachment): vscode.DebugConfiguration {
    const postDebugTask: unknown = config.postDebugTask;
    const presentation: unknown = config.presentation;
    const internalConsoleOptions: unknown = config.internalConsoleOptions;
    const common = {
        name: config.name, request: 'attach', ['__azureFunctionsHostId']: host.id,
        postDebugTask, presentation, internalConsoleOptions,
    };
    switch (runtime) {
        case 'node':
            // js-debug defaults continueOnAttach to false for attach requests, which would leave the worker
            // paused on its --inspect-brk entry line.
            return { ...common, type: 'pwa-node', address: '127.0.0.1', port: host.debugPort, continueOnAttach: true };
        case 'python':
            return { ...common, type: 'debugpy', connect: { host: '127.0.0.1', port: host.debugPort }, justMyCode: true };
        case 'java':
            return { ...common, type: 'java', hostName: '127.0.0.1', port: host.debugPort };
        case 'powershell':
            return { ...common, type: 'PowerShell', customPipeName: host.pipe, runspaceId: 1 };
        case 'native':
            return { ...common, type: 'go', mode: 'remote', debugAdapter: 'dlv-dap', host: '127.0.0.1', port: host.debugPort, cwd: project.fsPath };
        case 'dotnet-isolated':
            return { ...common, type: 'coreclr', processId: String(host.workerPid), justMyCode: true };
    }
}

const ProjectPathSchema = z.string().check(z.refine(path => path.trim().length > 0));
const EnvSchema = z.record(z.string(), z.string());
const HostArgsSchema = z.array(z.string());
const PortSchema = z.int().check(z.gte(1), z.lte(65535));

function isOwnedWorkerSetting(key: string): boolean {
    const normalized = key.replaceAll('__', ':').toLowerCase();
    return normalized === 'psworkercustompipename' || normalized === 'functions_worker_process_count'
        || /^languageworkers:.*:(?:arguments(?::.*)?|defaultexecutablepath)$/.test(normalized);
}

function parseOption<T extends z.ZodMiniType>(schema: T, value: unknown, message: string): z.output<T> | undefined {
    if (value === undefined) { return undefined; }
    const result = schema.safeParse(value);
    if (!result.success) {
        throw new ExternalError(message);
    }
    return result.data;
}
