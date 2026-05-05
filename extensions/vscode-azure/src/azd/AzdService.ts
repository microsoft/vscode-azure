/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProcessExecutor, IVsCode } from '@microsoft/vscode-azure-utils';
import { composeArgs, withArg, withFlagArg, withNamedArg, type CommandLineArgs } from '@microsoft/vscode-processutils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import { IAzdAuthServer } from './AzdAuthServer';

export const IAzdService: ServiceIdentifier<IAzdService> = Symbol.for('IAzdService');

const AzureYamlFileNames = ['azure.yaml', 'azure.yml'];

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
    readonly services?: Readonly<Record<string, unknown>>;
}

export interface IAzdService {
    /**
     * Returns the URI of `azure.yaml` or `azure.yml` in the given
     * directory, or `undefined` if neither exists.
     */
    findAzureYaml(directory: vscode.Uri): Promise<vscode.Uri | undefined>;

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
     * Runs `azd provision` as a foreground VS Code task.
     *
     * @throws if `azure.yaml` / `azure.yml` is not found in `cwd`.
     */
    provision(cwd: vscode.Uri): Promise<void>;
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
        @inject(IAzdAuthServer) private readonly authServer: IAzdAuthServer,
    ) { }

    public async findAzureYaml(directory: vscode.Uri): Promise<vscode.Uri | undefined> {
        for (const name of AzureYamlFileNames) {
            const fileUri = this.code.Uri.joinPath(directory, name);
            try {
                await this.code.workspace.fs.stat(fileUri);
                return fileUri;
            } catch {
                // file not found -- try next
            }
        }
        return undefined;
    }

    public async init(cwd: vscode.Uri): Promise<void> {
        try {
            await this.processExecutor.spawn({
                execution: 'background',
                command: 'azd',
                args: composeArgs(
                    withArg('init'),
                    withFlagArg('--minimal', true),
                    withFlagArg('--no-prompt', true),
                )(),
                cwd,
            });
        } catch (e) {
            throw this.wrapEnoent(e);
        }
    }

    public async envNew(name: string, location: string, subscriptionId: string, cwd: vscode.Uri): Promise<void> {
        try {
            await this.processExecutor.spawn({
                execution: 'background',
                command: 'azd',
                args: composeArgs(
                    withArg('env', 'new', name),
                    withNamedArg('--location', location),
                    withNamedArg('--subscription', subscriptionId),
                )(),
                cwd,
            });
        } catch (e) {
            throw this.wrapEnoent(e);
        }
    }

    public async envList(cwd: vscode.Uri): Promise<AzdEnvironment[]> {
        try {
            const result = await this.processExecutor.spawn<AzdEnvironment[]>({
                execution: 'background',
                command: 'azd',
                args: composeArgs(
                    withArg('env', 'list'),
                    withJsonOutput(),
                )(),
                cwd,
                parseJson: true,
            });
            return result.json;
        } catch (e) {
            throw this.wrapEnoent(e);
        }
    }

    public async envExists(name: string, cwd: vscode.Uri): Promise<boolean> {
        try {
            const envs = await this.envList(cwd);
            return envs.some(e => e.Name === name);
        } catch {
            return false;
        }
    }

    public async envGetValues(name: string, cwd: vscode.Uri): Promise<Record<string, string>> {
        try {
            const result = await this.processExecutor.spawn<Record<string, string>>({
                execution: 'background',
                command: 'azd',
                args: composeArgs(
                    withArg('env', 'get-values'),
                    withNamedArg('--environment', name),
                    withJsonOutput(),
                )(),
                cwd,
                parseJson: true,
            });
            return result.json;
        } catch {
            // azd not installed, env missing, or non-zero exit -- best effort
            return {};
        }
    }

    public async show(cwd: vscode.Uri): Promise<AzdShowResult | undefined> {
        try {
            const result = await this.processExecutor.spawn<AzdShowResult>({
                execution: 'background',
                command: 'azd',
                args: composeArgs(
                    withArg('show'),
                    withJsonOutput(),
                )(),
                cwd,
                parseJson: true,
            });
            return result.json;
        } catch {
            return undefined;
        }
    }

    public async provision(cwd: vscode.Uri): Promise<void> {
        const azureYamlUri = await this.findAzureYaml(cwd);
        if (!azureYamlUri) {
            throw new Error(this.code.l10n.t('Could not find azure.yaml or azure.yml in the project directory.'));
        }

        const authEnv = await this.authServer.getEnv();

        try {
            await this.processExecutor.spawn({
                execution: 'foreground',
                command: 'azd',
                args: composeArgs(
                    withArg('provision'),
                )(),
                cwd,
                env: authEnv,
                name: 'azd provision',
                source: 'azd',
                alwaysRunNew: true,
                focus: true,
            });
        } catch (e) {
            throw this.wrapEnoent(e);
        }
    }

    private wrapEnoent(e: unknown): unknown {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
            return new Error(
                this.code.l10n.t(
                    'Azure Developer CLI (azd) was not found. Install it from {0} and ensure it is available on your PATH.',
                    'https://aka.ms/azure-dev/install',
                ),
                { cause: e },
            );
        }
        return e;
    }
}

/** Curry function that appends `--output json` to the argument list. */
function withJsonOutput(): (args?: CommandLineArgs) => CommandLineArgs {
    return withNamedArg('--output', 'json');
}
