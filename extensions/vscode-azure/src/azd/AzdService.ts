/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, IActionExecutor, IProcessExecutor, IVsCode, command, fileExists, isProcessError, showMessage } from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import * as semver from 'semver';
import type * as vscode from 'vscode';
import { parseDocument } from 'yaml';
import { IToolService } from '../tools/ToolService';
import { IAzdAuthServer } from './AzdAuthServer';

export const IAzdService: ServiceIdentifier<IAzdService> = Symbol.for('IAzdService');

export const AzdCommand = 'azd';

/** Minimum `azd` version required by this extension. */
export const MinAzdVersion = '1.33.0-0';

/** File names that mark an azd project. */
export const AzureYamlFileNames = ['azure.yaml', 'azure.yml'];

/** Glob pattern matching `azure.yaml` / `azure.yml` at the workspace root only. */
export const AzureYamlGlobPattern = `{${AzureYamlFileNames.join(',')}}`;

/** A value that can be represented in `azure.yaml`. */
export type AzureYamlValue =
    | string
    | number
    | boolean
    | null
    | readonly AzureYamlValue[]
    | { readonly [key: string]: AzureYamlValue };

/**
 * Provides narrow, library-independent operations for updating `azure.yaml`.
 *
 * Paths address mapping keys from the document root. Missing parent mappings are
 * created, and an existing value at the path is replaced.
 */
export interface AzureYamlEditor {
    set(path: readonly [string, ...string[]], value: AzureYamlValue): void;
}

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

    /**
     * Applies a batch of comment-preserving updates to the azd project file in
     * {@linkcode cwd}.
     *
     * The updater is invoked once and awaited, and the file is written at most once.
     *
     * @deprecated This is a temporary workaround for missing first-class
     * `azure.yaml` editing in azd. Use with caution. It will be removed when azd
     * provides that capability. Track
     * https://github.com/microsoft/vscode-azure/issues/114 and
     * https://github.com/Azure/azure-dev/issues/9718.
     */
    updateAzureYaml(cwd: vscode.Uri, updater: (editor: AzureYamlEditor) => void | Promise<void>): Promise<void>;

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
     * Runs `azd pipeline config` as a visible VS Code task, interactively
     * configuring CI/CD (GitHub Actions or Azure Pipelines) for the project in
     * {@linkcode cwd}.
     *
     * Never passes `--no-prompt` -- `azd` may need to interactively
     * authenticate against the provider and/or the Git remote, and it offers to
     * create and push a repository when the project has none. Output is
     * never captured, so no secrets/PATs can leak into telemetry, logs, or
     * the output channel.
     *
     * @param provider - `'github'` or `'azdo'` (Azure DevOps). Omit to let
     *   `azd` prompt for one.
     * @param environmentName - Optional azd environment to target; passed as
     *   `--environment` when provided.
     */
    pipelineConfig(cwd: vscode.Uri, provider?: 'github' | 'azdo', environmentName?: string): Promise<void>;

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
     * target until an entry is added.
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
 * Returns the version of the `azd` at {@linkcode executablePath}, or `undefined`
 * when it is missing, fails to run, or reports something that is not valid
 * semver.
 *
 * Exported so {@linkcode AzdInstaller} can probe a candidate it has just found
 * or installed: the version gate and tool acquisition must agree on what counts
 * as a usable `azd`, which they only do by sharing this one implementation.
 */
export async function getAzdVersion(
    processExecutor: IProcessExecutor,
    executablePath: string = AzdCommand,
    cancellationToken?: vscode.CancellationToken,
): Promise<string | undefined> {
    try {
        const result = await processExecutor.spawn<AzdVersionResult>({
            execution: 'background',
            command: command(executablePath)
                .arg('version')
                .namedArg('--output', 'json'),
            parseJson: true,
        }, cancellationToken);
        return semver.valid(result.json.azd.version) ?? undefined;
    } catch (error) {
        // A cancelled probe means "we stopped looking", not "not installed", so
        // it must not be reported as a missing tool.
        if (CancellationError.test(error)) {
            throw error;
        }
        return undefined;
    }
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
        @inject(IToolService) private readonly tools: IToolService,
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
    public async updateAzureYaml(cwd: vscode.Uri, updater: (editor: AzureYamlEditor) => void | Promise<void>): Promise<void> {
        const files = await this.findAzureYaml(cwd);
        if (files.length === 0) {
            throw new Error(this.code.l10n.t('No azure.yaml or azure.yml file was found in "{0}".', cwd.fsPath));
        }
        const fileUri = files[0];

        const bytes = await this.code.workspace.fs.readFile(fileUri);
        const original = new TextDecoder().decode(bytes);
        const document = parseDocument(original, { keepSourceTokens: true });
        if (document.errors.length > 0) {
            throw new Error(this.code.l10n.t('The azd project file "{0}" contains invalid YAML.', fileUri.fsPath), {
                cause: document.errors[0],
            });
        }

        const updates: { readonly path: readonly string[]; readonly value: AzureYamlValue }[] = [];
        await updater({
            set: (path, value) => {
                if (path.length === 0 || path.some(segment => segment.length === 0)) {
                    throw new Error(this.code.l10n.t('azure.yaml update paths must contain at least one non-empty key.'));
                }

                updates.push({ path, value });
            },
        });

        if (updates.length === 0) {
            return;
        }

        for (const update of updates) {
            document.setIn(update.path, update.value);
        }

        const updated = document.toString();
        if (updated !== original) {
            await this.code.workspace.fs.writeFile(fileUri, new TextEncoder().encode(updated));
        }
    }

    /** @inheritdoc */
    public async init(cwd: vscode.Uri): Promise<void> {
        try {
            await this.processExecutor.spawn({
                execution: 'background',
                command: command(this.getAzdCommand())
                    .arg('init', '--minimal', '--no-prompt'),
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
                command: command(this.getAzdCommand())
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
                command: command(this.getAzdCommand())
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
                command: command(this.getAzdCommand())
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
                command: command(this.getAzdCommand())
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
                command: command(this.getAzdCommand()).arg('provision'),
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
                command: command(this.getAzdCommand()).arg('deploy'),
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
    public async pipelineConfig(cwd: vscode.Uri, provider?: 'github' | 'azdo', environmentName?: string): Promise<void> {
        const authEnv = await this.authServer.getEnv();

        try {
            await this.processExecutor.spawn({
                execution: 'foreground',
                command: command(this.getAzdCommand())
                    .arg('pipeline', 'config')
                    .namedArg('--provider', provider)
                    .namedArg('--environment', environmentName),
                cwd,
                env: authEnv,
                name: 'azd pipeline config',
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
                command: command(this.getAzdCommand())
                    .arg('down', '--force', '--purge'),
                cwd,
                env: authEnv,
                name: 'azd down',
                source: 'azd',
            });
        } catch (e) {
            throw await this.wrapAzdError(e);
        }
    }

    /** @inheritdoc */
    public async checkVersion(minVersion: string = MinAzdVersion): Promise<boolean | undefined> {
        const version = await getAzdVersion(this.processExecutor, this.getAzdCommand());
        return version ? semver.gte(version, minVersion) : undefined;
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

    /**
     * The `azd` executable to invoke: the absolute path found when the tool was
     * last acquired, or the bare command name so a normal `PATH` install works
     * without acquiring anything first.
     */
    private getAzdCommand(): string {
        return this.tools.getResolvedPath('azd') ?? AzdCommand;
    }
}
