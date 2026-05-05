/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseAzureResourceId } from '@microsoft/vscode-azure-azutils';
import { IProcessExecutor, IVsCode, stripAnsi, type JsonLinesProcessResult, type TerminalProcessResult } from '@microsoft/vscode-azure-utils';
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
     * Runs `azd provision` in a visible terminal with output capture.
     *
     * Uses shell integration to capture output and extract the ARM
     * deployment ID from the portal URL logged by azd. Falls back to
     * `azd provision --output json` in background mode when shell
     * integration is unavailable.
     *
     * The returned {@linkcode AzdProvisionCaptureResult.deploymentInfo}
     * promise resolves as soon as the deployment ID is found (before the
     * process completes).
     */
    provisionWithCapture(cwd: vscode.Uri): Promise<AzdProvisionCaptureResult>;

    /**
     * Runs `azd deploy` in a visible terminal with output capture.
     *
     * Uses shell integration to capture output and extract endpoint URLs.
     * Falls back to `azd deploy --output json` in background mode when
     * shell integration is unavailable.
     */
    deployWithCapture(cwd: vscode.Uri): Promise<AzdDeployCaptureResult>;
}

/** Parsed deployment information extracted from azd provision output. */
export interface AzdDeploymentInfo {
    readonly deploymentId: string;
    readonly subscriptionId: string;
}

/** Result of {@linkcode IAzdService.provisionWithCapture}. */
export interface AzdProvisionCaptureResult {
    /** Resolves when the deployment ID is found in the output, or `undefined` if not found. */
    readonly deploymentInfo: Promise<AzdDeploymentInfo | undefined>;
    /** Resolves when the provision process completes. Rejects on non-zero exit. */
    readonly completed: Promise<void>;
}

/** Result of {@linkcode IAzdService.deployWithCapture}. */
export interface AzdDeployCaptureResult {
    /** Endpoint URLs discovered from the deploy output. Populated after {@linkcode completed} resolves. */
    readonly endpointUrls: string[];
    /** Resolves when the deploy process completes. Rejects on non-zero exit. */
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

    public async provisionWithCapture(cwd: vscode.Uri): Promise<AzdProvisionCaptureResult> {
        const azureYamlUri = await this.findAzureYaml(cwd);
        if (!azureYamlUri) {
            throw new Error(this.code.l10n.t('Could not find azure.yaml or azure.yml in the project directory.'));
        }

        const authEnv = await this.authServer.getEnv();

        let terminalResult: TerminalProcessResult;
        try {
            terminalResult = await this.processExecutor.spawn({
                execution: 'terminal',
                command: 'azd',
                args: ['provision'],
                cwd,
                name: 'azd provision',
                env: authEnv,
            });
        } catch (e) {
            throw this.wrapEnoent(e);
        }

        if (terminalResult.shellIntegration) {
            return this.captureProvisionFromTerminal(terminalResult);
        }

        // Fallback: background mode with --output json
        return this.captureProvisionFromJson(cwd, authEnv);
    }

    public async deployWithCapture(cwd: vscode.Uri): Promise<AzdDeployCaptureResult> {
        const azureYamlUri = await this.findAzureYaml(cwd);
        if (!azureYamlUri) {
            throw new Error(this.code.l10n.t('Could not find azure.yaml or azure.yml in the project directory.'));
        }

        const authEnv = await this.authServer.getEnv();

        let terminalResult: TerminalProcessResult;
        try {
            terminalResult = await this.processExecutor.spawn({
                execution: 'terminal',
                command: 'azd',
                args: ['deploy'],
                name: 'azd deploy',
                cwd,
                env: authEnv,
            });
        } catch (e) {
            throw this.wrapEnoent(e);
        }

        if (terminalResult.shellIntegration) {
            return this.captureDeployFromTerminal(terminalResult);
        }

        // Fallback: background mode with --output json
        return this.captureDeployFromJson(cwd, authEnv);
    }

    private captureProvisionFromTerminal(result: TerminalProcessResult): AzdProvisionCaptureResult {
        const { promise: deploymentInfo, resolve } = Promise.withResolvers<AzdDeploymentInfo | undefined>();

        let found = false;
        const completed = (async () => {
            for await (const chunk of result.output) {
                if (!found) {
                    const info = parseDeploymentIdFromOutput(chunk);
                    if (info) {
                        found = true;
                        resolve(info);
                    }
                }
            }
            if (!found) {
                resolve(undefined);
            }
            const { exitCode } = await result.completed;
            if (exitCode !== undefined && exitCode !== 0) {
                throw new Error(this.code.l10n.t('azd provision exited with code {0}', exitCode));
            }
        })();

        return { deploymentInfo, completed };
    }

    private captureProvisionFromJson(cwd: vscode.Uri, env: Readonly<Record<string, string>>): AzdProvisionCaptureResult {
        const { promise: deploymentInfo, resolve } = Promise.withResolvers<AzdDeploymentInfo | undefined>();

        let found = false;
        const completed = (async () => {
            let jsonLinesResult: JsonLinesProcessResult<unknown, AzdStderrMessage>;
            try {
                jsonLinesResult = await this.processExecutor.spawn<unknown, AzdStderrMessage>({
                    execution: 'background',
                    command: 'azd',
                    args: composeArgs(withArg('provision'), withJsonOutput())(),
                    cwd,
                    env,
                    parseJson: true,
                    jsonLines: true,
                });
            } catch (e) {
                resolve(undefined);
                throw this.wrapEnoent(e);
            }

            for await (const line of jsonLinesResult.jsonLines) {
                if (!found && line.data?.message) {
                    const info = parseDeploymentIdFromOutput(line.data.message);
                    if (info) {
                        found = true;
                        resolve(info);
                    }
                }
            }
            if (!found) {
                resolve(undefined);
            }

            await jsonLinesResult.completed;
        })();

        return { deploymentInfo, completed };
    }

    private captureDeployFromTerminal(result: TerminalProcessResult): AzdDeployCaptureResult {
        const endpointUrls: string[] = [];

        const completed = (async () => {
            for await (const chunk of result.output) {
                const urls = parseEndpointUrlsFromOutput(chunk);
                for (const url of urls) {
                    if (!endpointUrls.includes(url)) {
                        endpointUrls.push(url);
                    }
                }
            }
            const { exitCode } = await result.completed;
            if (exitCode !== undefined && exitCode !== 0) {
                throw new Error(this.code.l10n.t('azd deploy exited with code {0}', exitCode));
            }
        })();

        return { endpointUrls, completed };
    }

    private captureDeployFromJson(cwd: vscode.Uri, env: Readonly<Record<string, string>>): AzdDeployCaptureResult {
        const endpointUrls: string[] = [];

        const completed = (async () => {
            let jsonLinesResult: JsonLinesProcessResult<AzdDeployStdout, AzdStderrMessage>;
            try {
                jsonLinesResult = await this.processExecutor.spawn<AzdDeployStdout, AzdStderrMessage>({
                    execution: 'background',
                    command: 'azd',
                    args: composeArgs(withArg('deploy'), withJsonOutput())(),
                    cwd,
                    env,
                    parseJson: true,
                    jsonLines: true,
                });
            } catch (e) {
                throw this.wrapEnoent(e);
            }

            // Drain stderr lines (deploy messages)
            // eslint-disable-next-line @typescript-eslint/no-unused-vars -- must drain the async generator
            for await (const line of jsonLinesResult.jsonLines) {
                // In JSON mode, endpoint URLs come from stdout, not stderr
            }

            const result = await jsonLinesResult.completed;
            const services = result.json.services;
            if (services) {
                for (const svc of Object.values(services)) {
                    for (const artifact of svc.artifacts ?? []) {
                        if (artifact.kind === 'endpoint' && artifact.location && !endpointUrls.includes(artifact.location)) {
                            endpointUrls.push(artifact.location);
                        }
                    }
                }
            }
        })();

        return { endpointUrls, completed };
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

// #region Output parsers

/** Shape of a JSON line emitted to stderr by `azd` with `--output json`. */
interface AzdStderrMessage {
    readonly type?: string;
    readonly data?: { readonly message?: string };
}

/** Shape of `azd deploy --output json` stdout. */
interface AzdDeployStdout {
    readonly services?: Readonly<Record<string, {
        readonly artifacts?: readonly {
            readonly kind?: string;
            readonly location?: string;
        }[];
    }>>;
}

/**
 * Regex matching the Azure Portal deployment URL logged by `azd provision`.
 *
 * The portal URL encodes the ARM deployment ID with `%2F`. We capture
 * everything after `/id/` up to whitespace, quote, or comma.
 */
const portalDeploymentUrlPattern = /DeploymentDetailsBlade.*?\/id\/([^\s"',]+)/i;

/**
 * Extracts the ARM deployment ID and subscription ID from azd output
 * containing a portal deployment URL.
 *
 * Works on both raw terminal output (after ANSI stripping) and plain
 * text from `--output json` stderr messages.
 */
export function parseDeploymentIdFromOutput(output: string): AzdDeploymentInfo | undefined {
    const cleaned = stripAnsi(output);
    const match = portalDeploymentUrlPattern.exec(cleaned);
    if (!match) {
        return undefined;
    }

    let deploymentId: string;
    try {
        deploymentId = decodeURIComponent(match[1]);
    } catch {
        return undefined;
    }

    try {
        const { subscriptionId } = parseAzureResourceId(deploymentId);
        return { deploymentId, subscriptionId };
    } catch {
        return undefined;
    }
}

/**
 * Regex matching https URLs in azd deploy output.
 * Captures any https URL; non-endpoint URLs (e.g. portal links) are
 * filtered out by {@linkcode parseEndpointUrlsFromOutput}.
 */
const httpsUrlPattern = /https:\/\/[^\s"',)]+/gi;

/** Hostname patterns that are not app endpoints (portal links, etc.). */
const nonEndpointHosts = [
    'portal.azure.com',
    'portal.azure.cn',
    'portal.azure.us',
    'portal.microsoftazure.de',
    'aka.ms',
];

/**
 * Extracts endpoint URLs from azd deploy terminal output.
 * Filters out Azure Portal and other non-endpoint URLs.
 */
export function parseEndpointUrlsFromOutput(output: string): string[] {
    const cleaned = stripAnsi(output);
    const matches = cleaned.match(httpsUrlPattern);
    if (!matches) {
        return [];
    }
    return matches.filter(url => {
        try {
            const host = new URL(url).hostname.toLowerCase();
            return !nonEndpointHosts.some(h => host === h || host.endsWith('.' + h));
        } catch {
            return false;
        }
    });
}

// #endregion
