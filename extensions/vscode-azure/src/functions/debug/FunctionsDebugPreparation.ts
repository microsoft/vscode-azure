/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, CaselessMap, command, dirname, ExternalError, fileExists, IProcessExecutor, IVsCode, type ICaselessMapReader } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { delimiter } from 'node:path';
import type * as vscode from 'vscode';
import { ExtensionId } from '../../constants';
import { IToolService } from '../../tools/ToolService';
import { FunctionsProjectSelector } from '../FunctionsProjectSelector';
import { LocalFunctionSettings } from '../LocalFunctionSettings';
import { LocalFunctionsNetwork } from '../host/LocalFunctionsNetwork';
import { isFunctionsDebugRuntime, type FunctionsDebugRuntime } from './functionsDebug';

interface GoApi {
    readonly settings?: {
        getExecutionCommand(toolName: string, resource?: vscode.Uri): { readonly binPath: string } | undefined;
    };
}

interface PythonApi {
    readonly ready: Promise<void>;
    readonly environments?: {
        getActiveEnvironmentPath(resource: vscode.Uri): { readonly path: string };
        resolveEnvironment(path: { readonly path: string }): Promise<{ readonly executable: { readonly uri?: vscode.Uri } } | undefined>;
        getEnvironmentVariables(resource: vscode.Uri): Promise<Readonly<Record<string, string | undefined>>>;
    };
}
interface PythonDebugApi {
    readonly debug?: {
        getRemoteLauncherCommand(host: string, port: number, wait: boolean): Promise<string[]>;
        getDebuggerPackagePath(): Promise<string | undefined>;
    };
}

interface GoTools {
    readonly go: string;
    readonly delve: string;
}

interface PythonEnvironment {
    readonly executable: string;
    readonly virtualEnvironment: vscode.Uri;
    readonly variables: Readonly<Record<string, string>>;
}

/** Settings and runtime prerequisites resolved once for one debug launch, never cached between launches. */
export type FunctionsDebugLaunch = {
    readonly project: vscode.Uri;
    readonly environment: Readonly<Record<string, string>>;
} & (
    | { readonly runtime: 'python'; readonly python: PythonEnvironment }
    | { readonly runtime: 'native'; readonly tools: GoTools }
    | { readonly runtime: Exclude<FunctionsDebugRuntime, 'python' | 'native'> }
);

/** Validates local projects and prepares workers; Core Tools owns ordinary builds and dependency restoration. */
@injectable()
export class FunctionsDebugPreparation {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IProcessExecutor) private readonly processes: IProcessExecutor,
        @inject(IToolService) private readonly tools: IToolService,
        @inject(LocalFunctionSettings) private readonly settings: LocalFunctionSettings,
        @inject(FunctionsProjectSelector) private readonly projects: FunctionsProjectSelector,
        @inject(LocalFunctionsNetwork) private readonly network: LocalFunctionsNetwork,
    ) { }

    /** Captures validated settings, launch overrides, and the selected Python environment or Go tools. */
    public async prepare(project: vscode.Uri, env: Readonly<Record<string, string>>, token?: vscode.CancellationToken): Promise<FunctionsDebugLaunch> {
        this.projects.assertLocal(project);
        const localSettings = this.code.Uri.joinPath(project, 'local.settings.json');
        if (this.code.workspace.textDocuments.some(document => document.uri.toString() === localSettings.toString() && document.isDirty)) {
            throw new ExternalError(this.code.l10n.t('Save local.settings.json before starting the Functions host.'));
        }
        const values = new CaselessMap((await this.settings.read(project)).values);
        applyEnvironmentOverrides(values, env);
        const runtime = values.get('FUNCTIONS_WORKER_RUNTIME')?.trim().toLowerCase();
        if (!isFunctionsDebugRuntime(runtime)) {
            throw new ExternalError(this.code.l10n.t('Set FUNCTIONS_WORKER_RUNTIME to node, python, java, powershell, dotnet-isolated, or native (Go) in local.settings.json before debugging.'));
        }
        const version = values.get('FUNCTIONS_EXTENSION_VERSION');
        if (version && !/^~?4(?:\.|$)/.test(version)) {
            throw new ExternalError(this.code.l10n.t('Local debugging supports Functions runtime v4 only.'));
        }
        await this.validateStorage(values);
        const snapshot = { project, environment: Object.fromEntries(values) };
        if (runtime === 'python') {
            return { ...snapshot, runtime, python: await this.selectedPython(project) };
        }
        if (runtime === 'native') {
            return { ...snapshot, runtime, tools: await this.validateGo(project, snapshot.environment, token) };
        }
        return { ...snapshot, runtime };
    }

    private async validateStorage(values: ICaselessMapReader<string>): Promise<void> {
        const storage = values.get('AzureWebJobsStorage');
        if (!storage && !values.get('AzureWebJobsStorage__accountName') && !values.get('AzureWebJobsStorage__blobServiceUri')) {
            throw new ExternalError(this.code.l10n.t('Configure AzureWebJobsStorage or its identity-based settings in local.settings.json before debugging.'));
        }
        if (storage && /(?:^|;)\s*UseDevelopmentStorage\s*=\s*true\s*(?:;|$)/i.test(storage)) {
            if (/DevelopmentStorageProxyUri/i.test(storage)) {
                throw new ExternalError(this.code.l10n.t('DevelopmentStorageProxyUri is not supported by the local emulator check. Configure explicit storage endpoints instead.'));
            }
            for (const port of [10000, 10001, 10002]) {
                if (!await this.network.listening(port)) {
                    throw new ExternalError(this.code.l10n.t('Start Azurite on its default loopback ports before debugging, or configure an Azure storage account.'));
                }
            }
        }
    }

    private async validateGo(project: vscode.Uri, env: Readonly<Record<string, string>>, token?: vscode.CancellationToken): Promise<GoTools> {
        if (!await fileExists(this.code, this.code.Uri.joinPath(project, 'go.mod'))) {
            throw new ExternalError(this.code.l10n.t('Native worker debugging requires a Go Functions project with go.mod. Custom handlers are not supported.'));
        }
        const tools = await this.goTools(project);
        try {
            const { stdout } = await this.processes.spawn({ execution: 'background', command: command(tools.go).arg('version'), cwd: project, env }, token);
            const version = /go version go(\d+)\.(\d+)(?:[.\s]|$)/.exec(stdout);
            if (!version || Number(version[1]) < 1 || (Number(version[1]) === 1 && Number(version[2]) < 24)) {
                throw new ExternalError(this.code.l10n.t('Go 1.24 or later is required to debug native Go Functions. Install or select a supported Go toolchain.'));
            }
            const delve = await this.processes.spawn({ execution: 'background', command: command(tools.delve).arg('version'), cwd: project, env }, token);
            if (!delve.stdout.includes('Delve Debugger') || !/Version:\s*\d+\.\d+/.test(delve.stdout)) {
                throw new ExternalError(this.code.l10n.t('Delve did not report a valid version. Install or update dlv with Go: Install/Update Tools.'));
            }
        } catch (error: unknown) {
            if (CancellationError.test(error) || error instanceof ExternalError) { throw error; }
            throw new ExternalError(this.code.l10n.t('Could not run the Go debugging tools. Install Go 1.24 or later and install dlv with Go: Install/Update Tools.'));
        }
        return tools;
    }

    public async executable(project: vscode.Uri, token?: vscode.CancellationToken): Promise<string> {
        this.projects.assertLocal(project);
        return (await this.tools.acquire({
            toolId: 'func', requestingExtensionId: ExtensionId, versionRange: '>=5.0.0-preview.3',
            cancellationToken: token, showProgressNotification: true, revealInstallTask: true,
        })).executablePath;
    }

    /** Builds Go with optimizations and inlining disabled so Delve can attach reliably. */
    public async buildGo(launch: Extract<FunctionsDebugLaunch, { readonly runtime: 'native' }>, token?: vscode.CancellationToken): Promise<void> {
        const { project, tools, environment: env } = launch;
        await this.code.workspace.fs.createDirectory(this.code.Uri.joinPath(project, 'bin'));
        await this.processes.spawn({
            execution: 'foreground',
            command: command(tools.go)
                .arg('build')
                .namedArg('-gcflags', 'all=-N -l', { assignCharacter: '=' })
                .namedArg('-o', this.goBinary(project).fsPath)
                .arg('.'),
            cwd: project, env,
            name: this.code.l10n.t('Build Azure Functions'), source: 'Azure Functions', alwaysRunNew: true,
            workspaceFolder: this.code.workspace.getWorkspaceFolder(project),
        }, token);
    }

    /** Applies project/launch overrides above Python environment defaults, then sets the owned debugger coordinates. */
    public async workerEnvironment(launch: FunctionsDebugLaunch, port: number, pipe: string): Promise<Readonly<Record<string, string>>> {
        const environment = new CaselessMap(Object.entries(launch.environment));
        applyEnvironmentOverrides(environment, {
            ...await this.workerOverrides(launch, port, pipe),
            ['FUNCTIONS_WORKER_RUNTIME']: launch.runtime,
            ['FUNCTIONS_WORKER_PROCESS_COUNT']: '1',
        });
        return Object.fromEntries(environment);
    }

    private async workerOverrides(launch: FunctionsDebugLaunch, port: number, pipe: string): Promise<Readonly<Record<string, string>>> {
        const debuggerExtensions: Partial<Record<FunctionsDebugRuntime, string>> = {
            java: 'vscjava.vscode-java-debug',
            powershell: 'ms-vscode.PowerShell',
            ['dotnet-isolated']: 'ms-dotnettools.csharp',
        };
        const extensionId = debuggerExtensions[launch.runtime];
        if (extensionId) {
            const extension = this.code.extensions.getExtension(extensionId);
            if (!extension) {
                throw new ExternalError(this.code.l10n.t('Install the {0} extension before debugging this project.', extensionId));
            }
            await extension.activate();
        }
        switch (launch.runtime) {
            case 'node':
                return { ['languageWorkers__node__arguments']: `--inspect-brk=127.0.0.1:${port}` };
            case 'java':
                return { ['languageWorkers__java__arguments']: `-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:${port}` };
            case 'powershell':
                return { ['PSWorkerCustomPipeName']: pipe };
            case 'native':
                return this.goWorkerEnvironment(launch, port);
            case 'python':
                return this.pythonWorkerEnvironment(launch.python, port, launch.environment);
            case 'dotnet-isolated':
                return {};
        }
    }

    private async goWorkerEnvironment(launch: Extract<FunctionsDebugLaunch, { readonly runtime: 'native' }>, port: number): Promise<Readonly<Record<string, string>>> {
        const { project, tools } = launch;
        const env: Readonly<Partial<Record<string, string>>> = launch.environment;
        const binary = this.goBinary(project);
        if (!await fileExists(this.code, binary)) {
            throw new ExternalError(this.code.l10n.t('Build the Go Functions project to bin/app (app.exe on Windows) with -gcflags=all=-N -l before debugging.'));
        }
        if (Object.keys(env).some(key => /^languageWorkers(?:__|:)native(?:__|:)(?:arguments(?:(?:__|:).*)?|defaultExecutablePath)$/i.test(key))) {
            throw new ExternalError(this.code.l10n.t('Native worker executable and argument overrides are not supported by the owned Go debugger. Use debugPort to configure its transport.'));
        }
        const args = [
            'exec', process.platform === 'win32' ? 'bin\\app.exe' : 'bin/app',
            '--headless', '--continue', `--listen=127.0.0.1:${port}`,
            '--api-version=2', '--accept-multiclient', '--',
        ];
        return {
            ['languageWorkers__native__defaultExecutablePath']: tools.delve,
            ['languageWorkers__native__arguments']: args.map(quoteWorkerArgument).join(' '),
            ['PATH']: `${dirname(this.code.Uri.file(tools.go)).fsPath}${delimiter}${env.PATH ?? env.Path ?? process.env.PATH ?? ''}`,
        };
    }

    private async pythonWorkerEnvironment(pythonEnvironment: PythonEnvironment, port: number, env: Readonly<Record<string, string>>): Promise<Readonly<Record<string, string>>> {
        const { executable: python, variables, virtualEnvironment } = pythonEnvironment;
        const extension = this.code.extensions.getExtension<PythonDebugApi | undefined>('ms-python.debugpy');
        if (!extension) {
            throw new ExternalError(this.code.l10n.t('Install the Python Debugger extension before debugging this project.'));
        }
        const api = await extension.activate();
        if (typeof api?.debug?.getRemoteLauncherCommand !== 'function' || typeof api.debug.getDebuggerPackagePath !== 'function') {
            throw new ExternalError(this.code.l10n.t('Update the Python Debugger extension to use its public debugpy launcher API.'));
        }
        const args = await api.debug.getRemoteLauncherCommand('127.0.0.1', port, true);
        const debuggerPath = await api.debug.getDebuggerPackagePath();
        if (!debuggerPath || !args.length) {
            throw new ExternalError(this.code.l10n.t('The Python Debugger extension did not provide a debugpy launcher.'));
        }
        // The launch command's first argument can be pre-quoted by the Python extension.
        args[0] = debuggerPath;
        const entries = [...Object.entries(variables), ...Object.entries(env)]
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
        const environment = process.platform === 'win32' ? new CaselessMap(entries) : new Map(entries);
        const path = environment.get('PATH');
        environment.delete('PATH');
        environment.delete('VIRTUAL_ENV');
        return {
            ...Object.fromEntries(environment),
            ['VIRTUAL_ENV']: virtualEnvironment.fsPath,
            ['PATH']: `${dirname(this.code.Uri.file(python)).fsPath}${delimiter}${path ?? process.env.PATH ?? ''}`,
            ['languageWorkers__python__defaultExecutablePath']: python,
            ['languageWorkers__python__arguments']: args.map(quoteWorkerArgument).join(' '),
        };
    }

    private goBinary(project: vscode.Uri): vscode.Uri {
        return this.code.Uri.joinPath(project, 'bin', process.platform === 'win32' ? 'app.exe' : 'app');
    }

    private async goTools(project: vscode.Uri): Promise<GoTools> {
        const extension = this.code.extensions.getExtension<GoApi | undefined>('golang.Go');
        if (!extension) {
            throw new ExternalError(this.code.l10n.t('Install the Go extension (golang.Go) before debugging native Go Functions.'));
        }
        const api = await extension.activate();
        if (typeof api?.settings?.getExecutionCommand !== 'function') {
            throw new ExternalError(this.code.l10n.t('Update the Go extension to use its public tool execution API.'));
        }
        const go = api.settings.getExecutionCommand('go', project)?.binPath;
        const delve = api.settings.getExecutionCommand('dlv', project)?.binPath;
        if (!go || !delve) {
            throw new ExternalError(this.code.l10n.t('Select a Go toolchain and install dlv with Go: Install/Update Tools before debugging.'));
        }
        return { go, delve };
    }

    private async selectedPython(project: vscode.Uri): Promise<PythonEnvironment> {
        const extension = this.code.extensions.getExtension<PythonApi | undefined>('ms-python.python');
        if (!extension) {
            throw new ExternalError(this.code.l10n.t('Install the Python extension and select an interpreter for this project before debugging.'));
        }
        const api = await extension.activate();
        await api?.ready;
        if (typeof api?.environments?.getActiveEnvironmentPath !== 'function' || typeof api.environments.resolveEnvironment !== 'function'
            || typeof api.environments.getEnvironmentVariables !== 'function') {
            throw new ExternalError(this.code.l10n.t('Update the Python extension to use its public environments API.'));
        }
        const environment = await api.environments.resolveEnvironment(api.environments.getActiveEnvironmentPath(project));
        const python = environment?.executable.uri?.fsPath;
        if (!python) {
            throw new ExternalError(this.code.l10n.t('Select a valid Python interpreter for this project before debugging.'));
        }
        const virtualEnvironment = dirname(dirname(this.code.Uri.file(python)));
        if (!await fileExists(this.code, this.code.Uri.joinPath(virtualEnvironment, 'pyvenv.cfg'))) {
            throw new ExternalError(this.code.l10n.t('Select a Python virtual environment for this project before debugging with Core Tools v5.'));
        }
        const variables = await api.environments.getEnvironmentVariables(project);
        return {
            executable: python,
            virtualEnvironment,
            variables: Object.fromEntries(Object.entries(variables)
                .filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
        };
    }
}

function applyEnvironmentOverrides(environment: CaselessMap<string>, overrides: Readonly<Record<string, string>>): void {
    for (const [key, value] of Object.entries(overrides)) {
        environment.delete(key);
        environment.set(key, value);
    }
}

function quoteWorkerArgument(value: string): string {
    return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}
