/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, fileExists, stringifyError, toAbortSignal, type CommandLineArgs, type IProcessExecutor, type IVsCode } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import * as path from 'node:path';
import * as semver from 'semver';
import type * as vscode from 'vscode';
import { createAzdToolDefinition } from './azdTool';

/** VS Code command that exposes {@linkcode IToolAcquisitionService.acquire} to other extensions. */
export const AcquireToolCommandId = 'vscode-azure/acquireTool';

/** Architectures supported by the initial tool acquisition API. */
export type ToolArchitecture = 'x64' | 'arm64';

/** Options accepted when acquiring the Azure Developer CLI. */
export type AzdToolOptions = Record<never, never>;

/**
 * Maps each supported tool identifier to its tool-specific options.
 *
 * Additions to this map automatically extend {@linkcode ToolAcquisitionRequest}.
 */
export interface ToolOptionsMap {
    readonly azd: AzdToolOptions;
}

/** Identifier for a tool supported by the acquisition service. */
export type ToolId = keyof ToolOptionsMap;

/** A phase reported while resolving or installing a tool. */
export type ToolAcquisitionPhase = 'resolve' | 'verify' | 'download' | 'install';

/** Neutral progress information emitted by {@linkcode IToolAcquisitionService}. */
export interface ToolAcquisitionProgress {
    readonly phase: ToolAcquisitionPhase;
    readonly message?: string;
    readonly warning?: boolean;
}

/** Controls progress reporting and foreground task presentation. */
export interface ToolProgressOptions {
    /** Receives progress independently of any VS Code progress notification. */
    readonly report?: (progress: ToolAcquisitionProgress) => void;
    /** Requests a cancellable VS Code progress notification from the command adapter. */
    readonly showNotification?: boolean;
    /** Focuses the foreground installation task. */
    readonly focusInstallTask?: boolean;
}

interface CommonToolAcquisitionRequest {
    /** Semver range that the resolved tool must satisfy. Any valid version is accepted when omitted. */
    readonly versionRange?: string;
    /** Extension requesting acquisition, in `publisher.name` form. */
    readonly requestingExtensionId: string;
    /** Absolute path to an executable managed by the caller. */
    readonly existingPath?: string;
    /**
     * Requires a strategy with signature verification or an equivalent trust guarantee.
     *
     * Explicit `true` fails when no such strategy is available. When omitted, a
     * non-verifying fallback is allowed after a warning. Explicit `false` opts out.
     */
    readonly requireSignature?: boolean;
    /** Defaults to the extension host architecture. */
    readonly architecture?: ToolArchitecture;
    readonly cancellationToken?: vscode.CancellationToken | AbortSignal;
    readonly progress?: ToolProgressOptions;
}

/** Typed request accepted by {@linkcode IToolAcquisitionService.acquire}. */
export type ToolAcquisitionRequest = {
    readonly [TTool in ToolId]: CommonToolAcquisitionRequest & {
        readonly toolId: TTool;
        readonly options?: ToolOptionsMap[TTool];
    };
}[ToolId];

/** How the executable returned by an acquisition request was obtained. */
export type ToolAcquisitionMethod =
    | 'existingPath'
    | 'path'
    | 'knownPath'
    | 'azdUpdate'
    | 'winget'
    | 'chocolatey'
    | 'homebrew'
    | 'officialScript';

/** Result returned after a tool has been resolved and verified. */
export interface ToolAcquisitionResult {
    readonly toolId: ToolId;
    readonly executablePath: string;
    readonly version: string;
    readonly method: ToolAcquisitionMethod;
    readonly installed: boolean;
}

/** Stable error codes returned to programmatic acquisition callers. */
export type ToolAcquisitionErrorCode =
    | 'invalidRequest'
    | 'unsupportedPlatform'
    | 'unsupportedArchitecture'
    | 'executableNotFound'
    | 'versionNotSatisfied'
    | 'signatureVerificationUnavailable'
    | 'installationFailed'
    | 'postInstallVerificationFailed';

/** Structured failure raised by the tool acquisition API. */
export class ToolAcquisitionError extends Error {
    public constructor(
        public readonly code: ToolAcquisitionErrorCode,
        message: string,
        public readonly learnMoreUrl?: string,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'ToolAcquisitionError';
    }
}

/** Runtime information used to choose tool paths and installation strategies. */
export interface ToolRuntime {
    readonly platform: NodeJS.Platform;
    readonly architecture: string;
    readonly env: Readonly<NodeJS.ProcessEnv>;
}

/** A resolved executable and its verified version. */
export interface ResolvedTool {
    readonly executablePath: string;
    readonly version: string;
    readonly method: 'existingPath' | 'path' | 'knownPath';
}

/** Context used to select an installation strategy. */
export interface ToolInstallContext {
    readonly runtime: ToolRuntime;
    readonly architecture: ToolArchitecture;
    readonly current?: ResolvedTool;
    readonly processExecutor: IProcessExecutor;
}

/** A foreground installation strategy supplied by a tool definition. */
export interface ToolInstallStrategy {
    readonly method: Exclude<ToolAcquisitionMethod, 'existingPath' | 'path' | 'knownPath'>;
    readonly command: CommandLineArgs;
    readonly signatureVerified: boolean;
}

/** Definition used by the coordinator to resolve, verify, and install one tool. */
export interface ToolDefinition<TTool extends ToolId = ToolId> {
    readonly id: TTool;
    readonly displayName: string;
    readonly description?: string;
    readonly executableName: string;
    readonly learnMoreUrl?: string;
    getKnownPaths(runtime: ToolRuntime): readonly string[];
    probeVersion(
        executablePath: string,
        processExecutor: IProcessExecutor,
        cancellation?: vscode.CancellationToken | AbortSignal,
    ): Promise<string | undefined>;
    getInstallStrategies(context: ToolInstallContext): readonly ToolInstallStrategy[];
}

interface InflightAcquisition {
    readonly controller: AbortController;
    readonly callers: Set<InflightCaller>;
    readonly promise: Promise<ToolAcquisitionResult>;
}

interface InflightCaller {
    readonly report?: ToolProgressOptions['report'];
}

/** Public tool acquisition service. */
export interface IToolAcquisitionService {
    /**
     * Resolves an acceptable existing executable or installs and verifies one.
     *
     * Concurrent equivalent requests share one installation operation.
     */
    acquire(request: ToolAcquisitionRequest): Promise<ToolAcquisitionResult>;

    /** Returns the most recently verified absolute executable path for a tool. */
    getResolvedPath(toolId: ToolId): string | undefined;
}

/** DI identifier for {@linkcode IToolAcquisitionService}. */
export const IToolAcquisitionService: ServiceIdentifier<IToolAcquisitionService> = Symbol.for('IToolAcquisitionService');

/**
 * Validates data received through the public VS Code command boundary.
 *
 * @throws {@linkcode ToolAcquisitionError} when any field is malformed or unsupported.
 */
export function validateToolAcquisitionRequest(input: unknown): ToolAcquisitionRequest {
    // TODO: Move to schema validation (for example, Zod) if tool-specific request variants become materially larger or more complex.
    if (!isRecord(input)) {
        throw invalidRequest('The tool acquisition request must be an object.');
    }

    const allowedKeys = new Set([
        'toolId',
        'options',
        'versionRange',
        'requestingExtensionId',
        'existingPath',
        'requireSignature',
        'architecture',
        'cancellationToken',
        'progress',
    ]);
    rejectUnknownKeys(input, allowedKeys, 'tool acquisition request');

    if (input.toolId !== 'azd') {
        throw invalidRequest(`Unsupported tool identifier: ${String(input.toolId)}.`);
    }
    const requestingExtensionId = input.requestingExtensionId;
    if (typeof requestingExtensionId !== 'string'
        || requestingExtensionId.length > 256
        || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(requestingExtensionId)) {
        throw invalidRequest('requestingExtensionId must use publisher.name format.');
    }
    const versionRange = input.versionRange;
    if (versionRange !== undefined
        && (typeof versionRange !== 'string'
            || versionRange.length > 256
            || semver.validRange(versionRange) === null)) {
        throw invalidRequest('versionRange must be a valid semver range.');
    }
    const existingPath = input.existingPath;
    if (existingPath !== undefined
        && (typeof existingPath !== 'string' || !path.isAbsolute(existingPath))) {
        throw invalidRequest('existingPath must be an absolute path.');
    }
    const requireSignature = input.requireSignature;
    if (requireSignature !== undefined && typeof requireSignature !== 'boolean') {
        throw invalidRequest('requireSignature must be a boolean.');
    }
    const architecture = input.architecture;
    if (architecture !== undefined && architecture !== 'x64' && architecture !== 'arm64') {
        throw invalidRequest('architecture must be x64 or arm64.');
    }
    const cancellationToken = input.cancellationToken;
    if (cancellationToken !== undefined && !isCancellation(cancellationToken)) {
        throw invalidRequest('cancellationToken must be a CancellationToken or AbortSignal.');
    }
    const options = input.options;
    if (options !== undefined) {
        if (!isRecord(options)) {
            throw invalidRequest('options must be an object.');
        }
        rejectUnknownKeys(options, new Set(), 'azd options');
    }
    const progress = input.progress;
    if (progress !== undefined) {
        validateProgress(progress);
    }

    return {
        toolId: 'azd',
        requestingExtensionId,
        versionRange,
        existingPath,
        requireSignature,
        architecture,
        cancellationToken,
        options,
        progress,
    };
}

/**
 * Default acquisition coordinator shared by commands and other extensions.
 *
 * The coordinator owns resolution order, version enforcement, cancellation,
 * signature policy, post-install verification, and in-process deduplication.
 */
export class ToolAcquisitionService implements IToolAcquisitionService {
    private readonly inflight = new Map<string, InflightAcquisition>();
    private readonly resolvedPaths = new Map<ToolId, string>();
    private readonly definitions: ReadonlyMap<ToolId, ToolDefinition>;

    public constructor(
        private readonly code: IVsCode,
        private readonly processExecutor: IProcessExecutor,
        definitions: readonly ToolDefinition[] = [createAzdToolDefinition()],
        private readonly runtime: ToolRuntime = {
            platform: process.platform,
            architecture: process.arch,
            env: process.env,
        },
    ) {
        this.definitions = new Map(definitions.map(definition => [definition.id, definition]));
    }

    /** @inheritdoc */
    public acquire(request: ToolAcquisitionRequest): Promise<ToolAcquisitionResult> {
        const validated = validateToolAcquisitionRequest(request);
        const architecture = validated.architecture ?? this.runtime.architecture;
        const key = [
            validated.toolId,
            architecture,
            validated.versionRange ?? '*',
            validated.existingPath ?? '',
            String(validated.requireSignature),
            JSON.stringify(validated.options ?? {}),
        ].join('|');

        const existing = this.inflight.get(key);
        if (existing) {
            return this.addCaller(existing, validated);
        }

        const controller = new AbortController();
        const callers = new Set<InflightCaller>();
        const sharedRequest: ToolAcquisitionRequest = {
            ...validated,
            cancellationToken: controller.signal,
            progress: {
                ...validated.progress,
                report: progress => {
                    for (const caller of callers) {
                        caller.report?.(progress);
                    }
                },
            },
        };
        const promise = Promise.resolve()
            .then(() => this.acquireCore(sharedRequest, architecture))
            .then(result => {
                this.resolvedPaths.set(result.toolId, result.executablePath);
                return result;
            })
            .finally(() => {
                this.inflight.delete(key);
            });
        const entry: InflightAcquisition = { controller, callers, promise };
        this.inflight.set(key, entry);
        return this.addCaller(entry, validated);
    }

    /** @inheritdoc */
    public getResolvedPath(toolId: ToolId): string | undefined {
        return this.resolvedPaths.get(toolId);
    }

    private addCaller(entry: InflightAcquisition, request: ToolAcquisitionRequest): Promise<ToolAcquisitionResult> {
        const caller: InflightCaller = { report: request.progress?.report };
        entry.callers.add(caller);
        const cancellation = toAbortSignal(request.cancellationToken);
        const signal = cancellation.signal;
        return new Promise<ToolAcquisitionResult>((resolve, reject) => {
            let settled = false;
            const cleanup = () => {
                entry.callers.delete(caller);
                signal?.removeEventListener('abort', cancel);
                cancellation.disposable.dispose();
            };
            const cancel = () => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                reject(new CancellationError());
                if (entry.callers.size === 0) {
                    entry.controller.abort();
                }
            };

            if (signal?.aborted) {
                cancel();
                return;
            }
            signal?.addEventListener('abort', cancel, { once: true });
            void entry.promise.then(
                result => {
                    if (!settled) {
                        settled = true;
                        cleanup();
                        resolve(result);
                    }
                },
                (error: unknown) => {
                    if (!settled) {
                        settled = true;
                        cleanup();
                        reject(error instanceof Error ? error : new Error(stringifyError(error)));
                    }
                },
            );
        });
    }

    private async acquireCore(request: ToolAcquisitionRequest, architecture: string): Promise<ToolAcquisitionResult> {
        throwIfAcquisitionCancelled(request.cancellationToken);
        if (architecture !== 'x64' && architecture !== 'arm64') {
            throw new ToolAcquisitionError(
                'unsupportedArchitecture',
                `Architecture '${architecture}' is not supported for ${request.toolId}.`,
            );
        }
        if (architecture !== this.runtime.architecture) {
            throw new ToolAcquisitionError(
                'unsupportedArchitecture',
                `Architecture '${architecture}' does not match the extension host architecture '${this.runtime.architecture}'.`,
            );
        }

        const definition = this.definitions.get(request.toolId);
        if (!definition) {
            throw invalidRequest(`Unsupported tool identifier: ${request.toolId}.`);
        }

        request.progress?.report?.({ phase: 'resolve' });
        const discovery = await this.discover(definition, request);
        throwIfAcquisitionCancelled(request.cancellationToken);
        if (discovery.satisfied) {
            return {
                toolId: definition.id,
                executablePath: discovery.satisfied.executablePath,
                version: discovery.satisfied.version,
                method: discovery.satisfied.method,
                installed: false,
            };
        }

        if (request.existingPath) {
            const message = discovery.current
                ? `${definition.displayName} at the requested path does not satisfy '${request.versionRange}'.`
                : `${definition.displayName} was not found at the requested path.`;
            throw new ToolAcquisitionError(
                discovery.current ? 'versionNotSatisfied' : 'executableNotFound',
                message,
                definition.learnMoreUrl,
            );
        }

        const strategies = definition.getInstallStrategies({
            runtime: this.runtime,
            architecture,
            current: discovery.current,
            processExecutor: this.processExecutor,
        });
        const strategy = request.requireSignature === true
            ? strategies.find(candidate => candidate.signatureVerified)
            : strategies[0];

        if (!strategy) {
            throw new ToolAcquisitionError(
                request.requireSignature === true ? 'signatureVerificationUnavailable' : 'unsupportedPlatform',
                request.requireSignature === true
                    ? `No verified installation method is available for ${definition.displayName} on this system.`
                    : `No installation method is available for ${definition.displayName} on this system.`,
                definition.learnMoreUrl,
            );
        }

        if (request.requireSignature === undefined && !strategy.signatureVerified) {
            request.progress?.report?.({
                phase: 'verify',
                warning: true,
                message: `The ${strategy.method} installation method cannot provide signature verification.`,
            });
        }

        request.progress?.report?.({ phase: strategy.method === 'officialScript' ? 'download' : 'install' });
        try {
            await this.processExecutor.spawn({
                execution: 'foreground',
                command: strategy.command,
                name: this.code.l10n.t('Install {0}', definition.displayName),
                source: definition.executableName,
                focus: request.progress?.focusInstallTask,
            }, request.cancellationToken);
        } catch (error) {
            if (CancellationError.test(error)) {
                throw error;
            }
            throw new ToolAcquisitionError(
                'installationFailed',
                `Failed to install ${definition.displayName} using ${strategy.method}.`,
                definition.learnMoreUrl,
                { cause: error },
            );
        }

        request.progress?.report?.({ phase: 'verify' });
        const installed = await this.discover(definition, request);
        if (!installed.satisfied) {
            throw new ToolAcquisitionError(
                'postInstallVerificationFailed',
                `${definition.displayName} could not be resolved with a supported version after installation.`,
                definition.learnMoreUrl,
            );
        }

        return {
            toolId: definition.id,
            executablePath: installed.satisfied.executablePath,
            version: installed.satisfied.version,
            method: strategy.method,
            installed: true,
        };
    }

    private async discover(
        definition: ToolDefinition,
        request: ToolAcquisitionRequest,
    ): Promise<{ satisfied?: ResolvedTool, current?: ResolvedTool }> {
        const candidates: { executablePath: string, method: ResolvedTool['method'] }[] = [];
        if (request.existingPath) {
            candidates.push({ executablePath: request.existingPath, method: 'existingPath' });
        } else {
            const onPath = this.processExecutor.resolveExecutable(definition.executableName);
            if (onPath) {
                candidates.push({ executablePath: onPath, method: 'path' });
            }
            for (const knownPath of definition.getKnownPaths(this.runtime)) {
                throwIfAcquisitionCancelled(request.cancellationToken);
                if (await fileExists(this.code, this.code.Uri.file(knownPath))) {
                    candidates.push({ executablePath: knownPath, method: 'knownPath' });
                }
            }
        }

        let current: ResolvedTool | undefined;
        const seen = new Set<string>();
        for (const candidate of candidates) {
            throwIfAcquisitionCancelled(request.cancellationToken);
            const key = this.runtime.platform === 'win32'
                ? candidate.executablePath.toLocaleLowerCase()
                : candidate.executablePath;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);

            request.progress?.report?.({ phase: 'verify' });
            const version = await definition.probeVersion(
                candidate.executablePath,
                this.processExecutor,
                request.cancellationToken,
            );
            if (!version) {
                continue;
            }

            const resolved: ResolvedTool = { ...candidate, version };
            current ??= resolved;
            if (!request.versionRange || semver.satisfies(version, request.versionRange, { includePrerelease: true })) {
                return { satisfied: resolved, current };
            }
        }

        return { current };
    }
}

function validateProgress(input: unknown): asserts input is ToolProgressOptions {
    if (!isRecord(input)) {
        throw invalidRequest('progress must be an object.');
    }
    rejectUnknownKeys(input, new Set(['report', 'showNotification', 'focusInstallTask']), 'progress');
    if (input.report !== undefined && typeof input.report !== 'function') {
        throw invalidRequest('progress.report must be a function.');
    }
    if (input.showNotification !== undefined && typeof input.showNotification !== 'boolean') {
        throw invalidRequest('progress.showNotification must be a boolean.');
    }
    if (input.focusInstallTask !== undefined && typeof input.focusInstallTask !== 'boolean') {
        throw invalidRequest('progress.focusInstallTask must be a boolean.');
    }
}

function isCancellation(input: unknown): input is vscode.CancellationToken | AbortSignal {
    return input instanceof AbortSignal
        || (isRecord(input)
            && typeof input.isCancellationRequested === 'boolean'
            && typeof input.onCancellationRequested === 'function');
}

function throwIfAcquisitionCancelled(cancellation?: vscode.CancellationToken | AbortSignal): void {
    const isCancelled = cancellation instanceof AbortSignal
        ? cancellation.aborted
        : cancellation?.isCancellationRequested;
    if (isCancelled) {
        throw new CancellationError();
    }
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function rejectUnknownKeys(input: Record<string, unknown>, allowed: ReadonlySet<string>, name: string): void {
    const unknown = Object.keys(input).find(key => !allowed.has(key));
    if (unknown) {
        throw invalidRequest(`Unknown ${name} field: ${unknown}.`);
    }
}

function invalidRequest(message: string): ToolAcquisitionError {
    return new ToolAcquisitionError('invalidRequest', message);
}
