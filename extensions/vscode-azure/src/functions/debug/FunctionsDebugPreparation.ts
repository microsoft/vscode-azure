/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { dirname, ExternalError, fileExists, IProcessExecutor, IVsCode, readText } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { delimiter } from 'node:path';
import type * as vscode from 'vscode';
import { ExtensionId } from '../../constants';
import { IToolService } from '../../tools/ToolService';
import { FunctionsProjectSelector } from '../FunctionsProjectSelector';
import { LocalFunctionSettings } from '../LocalFunctionSettings';
import { LocalFunctionsNetwork } from '../host/LocalFunctionsNetwork';

/** Worker stacks supported by the local attach flow. */
export type FunctionsDebugRuntime = 'node' | 'python' | 'java' | 'powershell' | 'dotnet-isolated';

/** Identifies supported worker stacks without offering an attach action for custom handlers. */
export function isFunctionsDebugRuntime(runtime: unknown): runtime is FunctionsDebugRuntime {
    return runtime === 'node' || runtime === 'python' || runtime === 'java' || runtime === 'powershell' || runtime === 'dotnet-isolated';
}

interface PythonApi {
    readonly ready: Promise<void>;
    readonly environments?: {
        getActiveEnvironmentPath(resource: vscode.Uri): { readonly path: string };
        resolveEnvironment(path: { readonly path: string }): Promise<{ readonly executable: { readonly uri?: vscode.Uri } } | undefined>;
        getEnvironmentVariables(resource: vscode.Uri): Readonly<Record<string, string | undefined>>;
    };
}
interface PythonDebugApi {
    readonly debug?: {
        getRemoteLauncherCommand(host: string, port: number, wait: boolean): Promise<string[]>;
        getDebuggerPackagePath(): Promise<string | undefined>;
    };
}

/** Performs local validation and builds, then prepares language worker arguments using the owning debugger APIs. */
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

    public async validate(project: vscode.Uri, env: Readonly<Record<string, string>>): Promise<FunctionsDebugRuntime> {
        this.projects.assertLocal(project);
        const localSettings = this.code.Uri.joinPath(project, 'local.settings.json');
        if (this.code.workspace.textDocuments.some(document => document.uri.toString() === localSettings.toString() && document.isDirty)) {
            throw new ExternalError(this.code.l10n.t('Save local.settings.json before starting the Functions host.'));
        }
        const values = { ...(await this.settings.read(project)).values, ...env };
        const runtime = values.FUNCTIONS_WORKER_RUNTIME?.trim().toLowerCase();
        if (!isFunctionsDebugRuntime(runtime)) {
            throw new ExternalError(this.code.l10n.t('Set FUNCTIONS_WORKER_RUNTIME to node, python, java, powershell, or dotnet-isolated in local.settings.json before debugging.'));
        }
        if (values.FUNCTIONS_EXTENSION_VERSION && !/^~?4(?:\.|$)/.test(values.FUNCTIONS_EXTENSION_VERSION)) {
            throw new ExternalError(this.code.l10n.t('Local debugging supports Functions runtime v4 only.'));
        }
        const storage = values.AzureWebJobsStorage;
        if (!storage && !values.AzureWebJobsStorage__accountName && !values.AzureWebJobsStorage__blobServiceUri) {
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
        return runtime;
    }

    public async executable(project: vscode.Uri, token?: vscode.CancellationToken): Promise<string> {
        this.projects.assertLocal(project);
        return (await this.tools.acquire({
            toolId: 'func', requestingExtensionId: ExtensionId, versionRange: '>=4.15.2 <5.0.0',
            cancellationToken: token, showProgressNotification: true, revealInstallTask: true,
        })).executablePath;
    }

    public async build(project: vscode.Uri, runtime: FunctionsDebugRuntime, env: Readonly<Record<string, string>>, token?: vscode.CancellationToken): Promise<vscode.Uri> {
        let command: string[] | undefined;
        let matcher: string | undefined;
        if (runtime === 'dotnet-isolated') { command = ['dotnet', 'build']; matcher = '$msCompile'; }
        if (runtime === 'java') { command = ['mvn', 'package']; }
        if (runtime === 'node') {
            const text = await readText(this.code, this.code.Uri.joinPath(project, 'package.json'));
            if (!text) { throw new ExternalError(this.code.l10n.t('The Node.js Functions project must contain package.json before debugging.')); }
            if (text) {
                let manifest: unknown;
                try { manifest = JSON.parse(text); } catch {
                    throw new ExternalError(this.code.l10n.t('package.json must contain valid JSON before debugging.'));
                }
                const installed = await fileExists(this.code, this.code.Uri.joinPath(project, 'node_modules'));
                if (!installed) {
                    await this.run(project, ['npm', await readText(this.code, this.code.Uri.joinPath(project, 'package-lock.json')) ? 'ci' : 'install'], env, token);
                }
                if (manifest && typeof manifest === 'object' && 'scripts' in manifest && manifest.scripts
                    && typeof manifest.scripts === 'object' && 'build' in manifest.scripts && typeof manifest.scripts.build === 'string') {
                    command = ['npm', 'run', 'build']; matcher = '$tsc';
                }
            }
        }
        if (runtime === 'python' && await readText(this.code, this.code.Uri.joinPath(project, 'requirements.txt'))) {
            const { executable: python } = await this.python(project);
            command = [python, '-m', 'pip', 'install', '-r', 'requirements.txt'];
        }
        if (command) { await this.run(project, command, env, token, matcher); }
        return this.hostDirectory(project, runtime);
    }

    public async hostDirectory(project: vscode.Uri, runtime: FunctionsDebugRuntime): Promise<vscode.Uri> {
        if (runtime !== 'java') { return project; }
        const root = this.code.Uri.joinPath(project, 'target', 'azure-functions');
        const apps = (await this.code.workspace.fs.readDirectory(root)).filter(([, type]) => type === this.code.FileType.Directory);
        if (apps.length !== 1) {
            throw new ExternalError(this.code.l10n.t('Package the Java project so target/azure-functions contains exactly one Function App.'));
        }
        return this.code.Uri.joinPath(root, apps[0][0]);
    }

    /** Applies project/launch overrides above Python environment defaults, then sets the owned debugger coordinates. */
    public async workerEnvironment(project: vscode.Uri, runtime: FunctionsDebugRuntime, port: number, pipe: string, env: Readonly<Partial<Record<string, string>>> = {}): Promise<Readonly<Record<string, string>>> {
        const extensionId = runtime === 'java' ? 'vscjava.vscode-java-debug'
            : runtime === 'powershell' ? 'ms-vscode.PowerShell'
                : runtime === 'dotnet-isolated' ? 'ms-dotnettools.csharp' : undefined;
        if (extensionId) {
            const extension = this.code.extensions.getExtension(extensionId);
            if (!extension) { throw new ExternalError(this.code.l10n.t('Install the {0} extension before debugging this project.', extensionId)); }
            await extension.activate();
        }
        if (runtime === 'node') { return { ['languageWorkers__node__arguments']: `--inspect-brk=127.0.0.1:${port}` }; }
        if (runtime === 'java') { return { ['languageWorkers__java__arguments']: `-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:${port}` }; }
        if (runtime === 'powershell') { return { ['PSWorkerCustomPipeName']: pipe }; }
        if (runtime === 'python') {
            const { executable: python, variables } = await this.python(project);
            const extension = this.code.extensions.getExtension<PythonDebugApi | undefined>('ms-python.debugpy');
            if (!extension) { throw new ExternalError(this.code.l10n.t('Install the Python Debugger extension before debugging this project.')); }
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
            return {
                ...variables,
                ...Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
                ['PATH']: `${dirname(this.code.Uri.file(python)).fsPath}${delimiter}${env.PATH ?? variables.PATH ?? process.env.PATH ?? ''}`,
                ['languageWorkers__python__defaultExecutablePath']: python,
                ['languageWorkers__python__arguments']: args.map(quoteWorkerArgument).join(' '),
            };
        }
        return {};
    }

    private async python(project: vscode.Uri): Promise<{
        readonly executable: string;
        readonly variables: Readonly<Partial<Record<string, string>>>;
    }> {
        const extension = this.code.extensions.getExtension<PythonApi | undefined>('ms-python.python');
        if (!extension) { throw new ExternalError(this.code.l10n.t('Install the Python extension and select an interpreter for this project before debugging.')); }
        const api = await extension.activate();
        await api?.ready;
        if (typeof api?.environments?.getActiveEnvironmentPath !== 'function' || typeof api.environments.resolveEnvironment !== 'function'
            || typeof api.environments.getEnvironmentVariables !== 'function') {
            throw new ExternalError(this.code.l10n.t('Update the Python extension to use its public environments API.'));
        }
        const environment = await api.environments.resolveEnvironment(api.environments.getActiveEnvironmentPath(project));
        const python = environment?.executable.uri?.fsPath;
        if (!python) { throw new ExternalError(this.code.l10n.t('Select a valid Python interpreter for this project before debugging.')); }
        return {
            executable: python,
            variables: Object.fromEntries(Object.entries(api.environments.getEnvironmentVariables(project))
                .filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
        };
    }

    private async run(project: vscode.Uri, command: readonly string[], env: Readonly<Record<string, string>>, token?: vscode.CancellationToken, problemMatchers?: string): Promise<void> {
        await this.processes.spawn({
            execution: 'foreground', command: [...command], cwd: project, env, problemMatchers,
            name: this.code.l10n.t('Build Azure Functions'), source: 'Azure Functions', alwaysRunNew: true,
            workspaceFolder: this.code.workspace.getWorkspaceFolder(project),
        }, token);
    }
}

function quoteWorkerArgument(value: string): string {
    return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}
