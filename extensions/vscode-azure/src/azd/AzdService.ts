/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionExecutor, IProcessExecutor, IVsCode, command, fileExists, isProcessError, showMessage, type CommandLineArgs } from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import * as semver from 'semver';
import type * as vscode from 'vscode';
import { IAzdAuthServer } from './AzdAuthServer';

export const IAzdService: ServiceIdentifier<IAzdService> = Symbol.for('IAzdService');

export const AzdCommand = 'azd';

/** Minimum `azd` version required by this extension. */
export const MinAzdVersion = '1.25.0-0';
/** Minimum `azd` version that supports the `azd update` command (public preview). */
export const MinAzdUpdateVersion = '1.23.14';

/** File names that mark an azd project. */
export const AzureYamlFileNames = ['azure.yaml', 'azure.yml'];

/** Glob pattern matching `azure.yaml` / `azure.yml` at the workspace root only. */
export const AzureYamlGlobPattern = `{${AzureYamlFileNames.join(',')}}`;

export interface IAzdService {
    /**
     * Finds `azure.yaml` or `azure.yml` files.
     *
     * When {@linkcode directory} is provided, checks only that folder
     * (stat-based). When omitted, searches across all open workspace
     * folders using {@linkcode vscode.workspace.findFiles findFiles}.
     *
     * @param directory - Scope the search to a single folder.
     * @param maxResults - Cap the number of results. Defaults to `1`.
     */
    findAzureYaml(directory?: vscode.Uri, maxResults?: number): Promise<vscode.Uri[]>;

    /** Runs `azd init --minimal --no-prompt` in the given directory. */
    init(cwd: vscode.Uri): Promise<void>;

    /** Runs `azd env new` with the given name, location, and subscription. */
    envNew(name: string, location: string, subscriptionId: string, cwd: vscode.Uri): Promise<void>;

    /** Runs `azd env list --output json` and returns the parsed environment list. */
    envList(cwd: vscode.Uri): Promise<AzdEnvironment[]>;

    /**
     * Returns `true` when an environment with the given {@linkcode name}
     * exists in {@linkcode cwd}. Implemented on top of {@linkcode IAzdService.envList envList};
     * a non-zero exit (e.g. azd not installed) is treated as `false`.
     */
    envExists(name: string, cwd: vscode.Uri): Promise<boolean>;

    /**
     * Runs `azd env get-values --environment <name> --output json` and
     * returns the parsed key/value map. Returns an empty object when the
     * call fails (e.g. azd not installed, env missing) so callers can
     * treat the result as best-effort.
     */
    envGetValues(name: string, cwd: vscode.Uri): Promise<Record<string, string>>;

    /**
     * Runs `azd show --output json` and returns the parsed project
     * metadata, or `undefined` when the call fails (typically because
     * there is no `azure.yaml` in {@linkcode cwd}).
     */
    show(cwd: vscode.Uri): Promise<AzdShowResult | undefined>;

    /**
     * Runs `azd provision` as a visible VS Code task.
     *
     * @param env - Additional environment variables to pass to the task
     *   (merged with the auth server env).
     */
    provision(cwd: vscode.Uri, env?: Readonly<Record<string, string>>): Promise<void>;

    /**
     * Runs `azd deploy` as a visible VS Code task.
     *
     * Resolves when the task completes successfully.
     * Rejects on non-zero exit.
     */
    deploy(cwd: vscode.Uri): Promise<void>;

    /**
     * Runs `azd down --force --purge` as a visible VS Code task, deleting
     * all resources provisioned for the project's default environment and
     * purging any soft-deleted resources.
     *
     * Resolves when the task completes successfully.
     * Rejects on non-zero exit.
     */
    down(cwd: vscode.Uri): Promise<void>;

    /**
     * Checks whether the installed `azd` version meets the given minimum.
     *
     * @param minVersion - Semver string to compare against (defaults to
     *   {@linkcode MinAzdVersion}).
     * @returns `true` if the installed version is >= {@linkcode minVersion},
     *   `false` if it is below, or `undefined` if the version could not be
     *   determined (e.g. azd not installed or version string is invalid).
     */
    checkVersion(minVersion?: string): Promise<boolean | undefined>;

    /**
     * Installs or updates the Azure Developer CLI via a visible VS Code
     * task. Clears the cached version so the next {@linkcode checkVersion}
     * call re-fetches it.
     */
    install(): Promise<void>;
}

/** An azd environment entry returned by `azd env list --output json`. */
export interface AzdEnvironment {
    readonly Name: string;
    readonly IsDefault: boolean;
}

/**
 * Project metadata returned by `azd show --output json`.
 *
 * Only the fields the wizard actually consumes are typed; the real
 * payload is richer (resources, supporting infra, etc.).
 */
export interface AzdShowResult {
    /** Project name from {@linkcode AzureYamlFileNames azure.yaml}. */
    readonly name?: string;
    /**
     * Map of `azd-service-name` -> service descriptor as declared under
     * `services:` in `azure.yaml`. An empty / missing object means no
     * services are configured -- `azd deploy` will not have anything to
     * target until the user runs `azd add`.
     */
    readonly services?: Readonly<Record<string, AzdServiceDescriptor>>;
}

/** A single service entry from {@linkcode AzdShowResult.services}. */
export interface AzdServiceDescriptor extends Record<string, unknown> {
    /** Ingress URL for the deployed service, if available. */
    readonly ingressUrl?: string;
    /** Project containing the source code for this service. */
    readonly project?: {
        /** Absolute filesystem path to the service's project folder. */
        readonly path?: string;
        /** Programming language of the service. */
        readonly language?: string;
    };
}

/** Result of `azd version --output json`. */
interface AzdVersionResult {
    readonly azd: {
        readonly version: string;
        readonly commit: string;
    };
}

/**
 * Wraps {@linkcode IProcessExecutor} to provide a typed interface for
 * invoking the Azure Developer CLI (`azd`). Handles the common
 * `ENOENT` error with an actionable install hint.
 */
@injectable()
export class AzdService implements IAzdService {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IProcessExecutor) private readonly processExecutor: IProcessExecutor,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IAzdAuthServer) private readonly authServer: IAzdAuthServer,
    ) { }

    /** @inheritdoc */
    public async findAzureYaml(directory?: vscode.Uri, maxResults: number = 1): Promise<vscode.Uri[]> {
        if (directory) {
            for (const name of AzureYamlFileNames) {
                const fileUri = this.code.Uri.joinPath(directory, name);
                if (await fileExists(this.code, fileUri)) {
                    return [fileUri];
                }
            }
            return [];
        }

        // Search across all workspace folders via findFiles.
        return this.code.workspace.findFiles(AzureYamlGlobPattern, undefined, maxResults);
    }

    /** @inheritdoc */
    public async init(cwd: vscode.Uri): Promise<void> {
        try {
            await this.processExecutor.spawn({
                execution: 'background',
                command: command(AzdCommand)
                    .arg('init')
                    .flagArg('--minimal')
                    .flagArg('--no-prompt'),
                cwd,
            });
        } catch (e) {
            throw await this.wrapAzdError(e);
        }
    }

    /** @inheritdoc */
    public async envNew(name: string, location: string, subscriptionId: string, cwd: vscode.Uri): Promise<void> {
        try {
            await this.processExecutor.spawn({
                execution: 'background',
                command: command(AzdCommand)
                    .arg('env', 'new', name)
                    .namedArg('--location', location)
                    .namedArg('--subscription', subscriptionId),
                cwd,
            });
        } catch (e) {
            throw await this.wrapAzdError(e);
        }
    }

    /** @inheritdoc */
    public async envList(cwd: vscode.Uri): Promise<AzdEnvironment[]> {
        try {
            const result = await this.processExecutor.spawn<AzdEnvironment[]>({
                execution: 'background',
                command: command(AzdCommand)
                    .arg('env', 'list')
                    .namedArg('--output', 'json'),
                cwd,
                parseJson: true,
            });
            return result.json;
        } catch (e) {
            throw await this.wrapAzdError(e);
        }
    }

    /** @inheritdoc */
    public async envExists(name: string, cwd: vscode.Uri): Promise<boolean> {
        try {
            const envs = await this.envList(cwd);
            return envs.some(e => e.Name === name);
        } catch {
            return false;
        }
    }

    /** @inheritdoc */
    public async envGetValues(name: string, cwd: vscode.Uri): Promise<Record<string, string>> {
        try {
            const result = await this.processExecutor.spawn<Record<string, string>>({
                execution: 'background',
                command: command(AzdCommand)
                    .arg('env', 'get-values')
                    .namedArg('--environment', name)
                    .namedArg('--output', 'json'),
                cwd,
                parseJson: true,
            });
            return result.json;
        } catch {
            // azd not installed, env missing, or non-zero exit -- best effort
            return {};
        }
    }

    /** @inheritdoc */
    public async show(cwd: vscode.Uri): Promise<AzdShowResult | undefined> {
        try {
            const result = await this.processExecutor.spawn<AzdShowResult>({
                execution: 'background',
                command: command(AzdCommand)
                    .arg('show')
                    .namedArg('--output', 'json'),
                cwd,
                parseJson: true,
            });
            return result.json;
        } catch {
            return undefined;
        }
    }

    /** @inheritdoc */
    public async provision(cwd: vscode.Uri, env?: Readonly<Record<string, string>>): Promise<void> {
        const authEnv = await this.authServer.getEnv();

        try {
            await this.processExecutor.spawn({
                execution: 'foreground',
                command: command(AzdCommand).arg('provision'),
                cwd,
                env: { ...authEnv, ...env },
                name: 'azd provision',
                source: 'azd',
            });
        } catch (e) {
            throw await this.wrapAzdError(e);
        }
    }

    /** @inheritdoc */
    public async deploy(cwd: vscode.Uri): Promise<void> {
        const authEnv = await this.authServer.getEnv();

        try {
            await this.processExecutor.spawn({
                execution: 'foreground',
                command: command(AzdCommand).arg('deploy'),
                cwd,
                env: authEnv,
                name: 'azd deploy',
                source: 'azd',
            });
        } catch (e) {
            throw await this.wrapAzdError(e);
        }
    }

    /** @inheritdoc */
    public async down(cwd: vscode.Uri): Promise<void> {
        const authEnv = await this.authServer.getEnv();

        try {
            await this.processExecutor.spawn({
                execution: 'foreground',
                command: command(AzdCommand)
                    .arg('down')
                    .flagArg('--force')
                    .flagArg('--purge'),
                cwd,
                env: authEnv,
                name: 'azd down',
                source: 'azd',
            });
        } catch (e) {
            throw await this.wrapAzdError(e);
        }
    }

    private cachedVersion: string | false | undefined;

    /** @inheritdoc */
    public async checkVersion(minVersion: string = MinAzdVersion): Promise<boolean | undefined> {
        if (this.cachedVersion === undefined) {
            try {
                const result = await this.processExecutor.spawn<AzdVersionResult>({
                    execution: 'background',
                    command: command(AzdCommand)
                        .arg('version')
                        .namedArg('--output', 'json'),
                    parseJson: true,
                });
                const version = semver.valid(result.json.azd.version);
                this.cachedVersion = version ?? false;
            } catch {
                this.cachedVersion = false;
            }
        }

        if (this.cachedVersion === false) {
            return undefined;
        }

        return semver.gte(this.cachedVersion, minVersion);
    }

    /** @inheritdoc */
    public async install(): Promise<void> {
        await this.processExecutor.spawn({
            execution: 'foreground',
            command: await this.getInstallCommand(),
            name: this.code.l10n.t('Install Azure Developer CLI'),
            source: 'azd',
        });

        this.cachedVersion = undefined;
    }

    /**
     * Returns the preferred install/update command as an argument vector.
     *
     * When `azd` is already installed and supports `azd update`
     * (>= {@linkcode MinAzdUpdateVersion}), returns `azd update`.
     * Otherwise falls back to a platform-specific install command
     * (winget, choco, brew, or the official install script).
     */
    private async getInstallCommand(): Promise<CommandLineArgs> {
        const supportsUpdate = await this.checkVersion(MinAzdUpdateVersion);
        if (supportsUpdate) {
            return command(AzdCommand).arg('update');
        } else if (process.platform === 'win32') {
            if (await this.processExecutor.isOnPath('winget')) {
                // `winget install` upgrades already-installed packages by default
                return command('winget').arg('install', 'microsoft.azd');
            } else if (await this.processExecutor.isOnPath('choco')) {
                // `choco upgrade` installs if missing and upgrades if already installed
                return command('choco').arg('upgrade', 'azd');
            } else {
                return command('powershell')
                    .namedArg('-ExecutionPolicy', 'AllSigned')
                    .arg('-c', 'Invoke-RestMethod \'https://aka.ms/install-azd.ps1\' | Invoke-Expression');
            }
        } else if (process.platform === 'darwin' && await this.processExecutor.isOnPath('brew')) {
            // `brew install` upgrades already-installed packages by default
            return command('brew').arg('install', 'azure/azd/azd');
        } else {
            return command('bash').arg('-c', 'curl -fsSL \'https://aka.ms/install-azd.sh\' | bash');
        }
    }

    /**
     * Wraps errors from `azd` commands with actionable messages.
     * - azd not installed (`ENOENT`, or a {@linkcode checkVersion} probe that
     *   cannot produce a version) -> "not found"
     * - Installed but below {@linkcode MinAzdVersion} -> "version required"
     *
     * Shows a toast with an "Install" button and suppresses the
     * default error dialog when the error is actionable.
     */
    private async wrapAzdError(e: unknown): Promise<unknown> {
        // A raw ENOENT is already conclusive, so skip the extra version probe.
        // Otherwise let `checkVersion` decide: it returns `undefined` when it
        // cannot produce a version at all (effectively not installed), `false`
        // when azd is present but too old, and `true` when azd is usable.
        const meetsMin = isProcessError(e) && e.code === 'ENOENT'
            ? undefined
            : await this.checkVersion();

        if (meetsMin === undefined) {
            const message = this.code.l10n.t(
                'Azure Developer CLI (azd) was not found. Install it and ensure it is available on your PATH.',
            );
            this.showInstallToast(message);
            return new Error(message, { cause: e });
        }

        if (!meetsMin) {
            const message = this.code.l10n.t(
                'Azure Developer CLI (azd) version {0} or later is required.',
                MinAzdVersion,
            );
            this.showInstallToast(message);
            return new Error(message, { cause: e });
        }

        return e;
    }

    /**
     * Shows a warning toast with an "Install" button that runs the
     * {@linkcode install} command. Suppresses the default error dialog
     * on the current action context, if available.
     */
    private showInstallToast(message: string): void {
        const context = this.executor.currentContext;
        if (context) {
            context.errorHandling.suppress = 'display';
        }

        const installLabel = this.code.l10n.t('Install');
        void showMessage(this.code, message, { severity: 'warning' }, installLabel).then(choice => {
            if (choice === installLabel) {
                void this.code.commands.executeCommand('vscode-azure/installAzd');
            }
        });
    }
}
