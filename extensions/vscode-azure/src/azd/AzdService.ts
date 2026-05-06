/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseAzureResourceId } from '@microsoft/vscode-azure-azutils';
import { IProcessExecutor, IVsCode } from '@microsoft/vscode-azure-utils';
import { composeArgs, withArg, withFlagArg, withNamedArg, type CommandLineArgs } from '@microsoft/vscode-processutils';
import * as crypto from 'crypto';
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
    readonly services?: Readonly<Record<string, AzdServiceDescriptor>>;
}

/** A single service entry from {@linkcode AzdShowResult.services}. */
export interface AzdServiceDescriptor extends Record<string, unknown> {
    /** Ingress URL for the deployed service, if available. */
    readonly ingressUrl?: string;
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
     * Runs `azd provision` as a visible VS Code task.
     *
     * Sets `AZD_DEPLOYMENT_ID_FILE` to a temp file in {@linkcode storageDir}
     * so azd can emit the ARM deployment ID. The returned
     * {@linkcode AzdProvisionCaptureResult.deploymentInfo} promise
     * resolves when the file appears (polled every 3 s, up to 2 min).
     */
    provisionWithCapture(cwd: vscode.Uri, storageDir: vscode.Uri): Promise<AzdProvisionCaptureResult>;

    /**
     * Runs `azd deploy` as a visible VS Code task.
     *
     * Resolves when the task completes successfully.
     * Rejects on non-zero exit.
     */
    deployWithCapture(cwd: vscode.Uri): Promise<void>;
}

/** Parsed deployment information extracted from azd provision output. */
export interface AzdDeploymentInfo {
    readonly deploymentId: string;
    readonly subscriptionId: string;
}

/** Result of {@linkcode IAzdService.provisionWithCapture}. */
export interface AzdProvisionCaptureResult {
    /** Resolves when the deployment ID file appears, or `undefined` on timeout. */
    readonly deploymentInfo: Promise<AzdDeploymentInfo | undefined>;
    /** Resolves when the provision task completes. Rejects on non-zero exit. */
    readonly completed: Promise<void>;
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

    public async provisionWithCapture(cwd: vscode.Uri, storageDir: vscode.Uri): Promise<AzdProvisionCaptureResult> {
        const azureYamlUri = await this.findAzureYaml(cwd);
        if (!azureYamlUri) {
            throw new Error(this.code.l10n.t('Could not find azure.yaml or azure.yml in the project directory.'));
        }

        const authEnv = await this.authServer.getEnv();

        // Create a temp directory for the deployment ID file
        const deployIdDir = this.code.Uri.joinPath(storageDir, `azd-${crypto.randomUUID().slice(0, 8)}`);
        await this.code.workspace.fs.createDirectory(deployIdDir);
        const deployIdFileUri = this.code.Uri.joinPath(deployIdDir, 'deployment-id.json');

        const env: Record<string, string> = {
            ...authEnv,
            AZD_DEPLOYMENT_ID_FILE: deployIdFileUri.fsPath, // eslint-disable-line @typescript-eslint/naming-convention
        };

        const completed = this.processExecutor.spawn({
            execution: 'foreground',
            command: 'azd',
            args: ['provision'],
            cwd,
            name: 'azd provision',
            source: 'azd',
            env,
            alwaysRunNew: true,
            focus: true,
        }).catch((e: unknown) => { throw this.wrapEnoent(e); });

        const deploymentInfo = this.pollForDeploymentIdFile(deployIdFileUri);

        return { deploymentInfo, completed };
    }

    public async deployWithCapture(cwd: vscode.Uri): Promise<void> {
        const azureYamlUri = await this.findAzureYaml(cwd);
        if (!azureYamlUri) {
            throw new Error(this.code.l10n.t('Could not find azure.yaml or azure.yml in the project directory.'));
        }

        const authEnv = await this.authServer.getEnv();

        try {
            await this.processExecutor.spawn({
                execution: 'foreground',
                command: 'azd',
                args: ['deploy'],
                name: 'azd deploy',
                source: 'azd',
                cwd,
                env: authEnv,
                alwaysRunNew: true,
                focus: true,
            });
        } catch (e) {
            throw this.wrapEnoent(e);
        }
    }

    /**
     * Polls for the deployment ID file to appear. Checks every
     * {@linkcode deployIdPollIntervalMs} for up to {@linkcode deployIdPollTimeoutMs}.
     *
     * Returns the parsed deployment info, or `undefined` on timeout.
     */
    private async pollForDeploymentIdFile(fileUri: vscode.Uri): Promise<AzdDeploymentInfo | undefined> {
        const start = Date.now();
        while (Date.now() - start < deployIdPollTimeoutMs) {
            try {
                const content = await this.code.workspace.fs.readFile(fileUri);
                const text = new TextDecoder().decode(content);
                const parsed = JSON.parse(text) as { deploymentId?: string };
                if (parsed.deploymentId) {
                    const { subscriptionId } = parseAzureResourceId(parsed.deploymentId);
                    return { deploymentId: parsed.deploymentId, subscriptionId };
                }
            } catch {
                // File doesn't exist yet or isn't valid -- keep polling
            }
            await new Promise(resolve => setTimeout(resolve, deployIdPollIntervalMs));
        }
        return undefined;
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

/** Interval in milliseconds between polls for the deployment ID file. */
const deployIdPollIntervalMs = 3000;
/** Maximum time in milliseconds to poll for the deployment ID file. */
const deployIdPollTimeoutMs = 120_000;
