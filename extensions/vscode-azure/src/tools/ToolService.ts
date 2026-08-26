/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fileExists, InflightMap, IProcessExecutor, IVsCode, type Satisfies } from '@microsoft/vscode-azure-utils';
import { inject, injectable, multiInject, type ServiceIdentifier } from 'inversify';
import * as path from 'node:path';
import * as semver from 'semver';
import type * as vscode from 'vscode';
import * as z from 'zod/mini';
import { ExtensionId } from '../constants';
import { IToolInstaller, type ToolInstaller } from './ToolInstaller';

/**
 * Command other extensions call to resolve or install a tool:
 *
 * ```ts
 * const { executablePath } = await vscode.commands.executeCommand<AcquireToolResult>(
 *     AcquireToolCommandId,
 *     { toolId: 'azd', requestingExtensionId: 'publisher.name', versionRange: '>=1.25.0' },
 * );
 * ```
 */
export const AcquireToolCommandId = 'vscode-azure/acquireTool';

/**
 * Tools that can be acquired.
 *
 * An id may be listed here before an installer for it exists; requesting one
 * that has no registered {@linkcode ToolInstaller} is rejected by name.
 */
export const ToolIds = ['azd', 'func', 'swa'] as const;

/** Identifies a tool that can be acquired. */
export type ToolId = typeof ToolIds[number];

/** Input to {@linkcode IToolService.acquire}. */
export interface AcquireToolRequest {
    readonly toolId: ToolId;

    /** Extension asking for the tool, as `publisher.name`. Recorded in telemetry. */
    readonly requestingExtensionId: string;

    /**
     * Semver range the tool must satisfy. Defaults to whatever range the tool
     * itself declares, so callers with no particular requirement can omit it.
     */
    readonly versionRange?: string;

    /** Absolute path to an executable the caller manages itself. */
    readonly existingPath?: string;

    /**
     * Installs even when an acceptable executable is already present, so the
     * tool is updated to the newest version its installer can reach. Defaults
     * to `false`, which returns the first acceptable executable found.
     *
     * Ignored when {@linkcode existingPath} is set, since a caller-managed
     * executable is never installed over.
     */
    readonly force?: boolean;

    /**
     * Fails rather than installing through a method that cannot verify what it
     * downloads. Defaults to `false`, in which case an unverified fallback is
     * used only after logging a warning.
     */
    readonly requireSignature?: boolean;

    /** Shows a cancellable progress notification. Defaults to `false`. */
    readonly showProgressNotification?: boolean;

    /** Reveals the installation task's terminal. Defaults to `false`. */
    readonly revealInstallTask?: boolean;

    readonly cancellationToken?: vscode.CancellationToken;

    /** Receives progress messages suitable for display to a user. */
    readonly progress?: (message: string) => void;
}

/** Result of {@linkcode IToolService.acquire}. */
export interface AcquireToolResult {
    /** Absolute path to an executable that satisfies the request. */
    readonly executablePath: string;
}

export const IToolService: ServiceIdentifier<IToolService> = Symbol.for('IToolService');

/** Resolves tools that are already present, and installs them when they are not. */
export interface IToolService {
    /**
     * Returns an executable satisfying {@linkcode request}, installing the tool
     * if no acceptable one is found -- or, when the request is forced, even if
     * one is.
     *
     * Concurrent requests for the same tool and version range share a single
     * installation, so callers cannot race each other's package manager.
     *
     * @throws When the request is malformed, or when no acceptable executable
     *   can be produced.
     */
    acquire(request: AcquireToolRequest): Promise<AcquireToolResult>;

    /**
     * The path most recently returned by {@linkcode acquire} for {@linkcode toolId},
     * or `undefined` if it has not been acquired in this session.
     *
     * Lets callers run a tool that was installed somewhere outside the
     * extension host's `PATH` without waiting for a reload.
     */
    getResolvedPath(toolId: ToolId): string | undefined;
}

/**
 * Shape of a request once validated: the caller's optional flags have been
 * resolved to concrete booleans, so consumers never repeat a default.
 */
export type NormalizedToolRequest = z.output<typeof AcquireToolRequestSchema>;

/** Matches a VS Code {@linkcode vscode.CancellationToken CancellationToken} structurally. */
function isCancellationToken(value: unknown): value is vscode.CancellationToken {
    const token = value as vscode.CancellationToken | undefined;
    return typeof token?.isCancellationRequested === 'boolean'
        && typeof token.onCancellationRequested === 'function';
}

/**
 * Validates and normalizes an acquisition request.
 *
 * Requests arrive from other extensions through a command, so every field is
 * treated as untrusted -- including the callbacks and cancellation token, which
 * would otherwise fail much later inside a spawn.
 */
const AcquireToolRequestSchema = z.object({
    toolId: z.enum(ToolIds),
    requestingExtensionId: z.string().check(
        z.regex(/^[^.\s]+\.[^.\s]+$/, 'requestingExtensionId must be in publisher.name form'),
    ),
    versionRange: z.optional(z.string().check(
        z.refine(value => semver.validRange(value) !== null, 'versionRange must be a valid semver range'),
    )),
    existingPath: z.optional(z.string().check(
        z.refine(value => path.isAbsolute(value), 'existingPath must be an absolute path'),
    )),
    force: z._default(z.boolean(), false),
    requireSignature: z._default(z.boolean(), false),
    showProgressNotification: z._default(z.boolean(), false),
    revealInstallTask: z._default(z.boolean(), false),
    cancellationToken: z.optional(z.custom<vscode.CancellationToken>(
        isCancellationToken,
        'cancellationToken must be a CancellationToken',
    )),
    progress: z.optional(z.custom<(message: string) => void>(
        value => typeof value === 'function',
        'progress must be a function',
    )),
});

// The documented request interface is hand-written so consumers get real
// JSDoc rather than an inferred blob; this keeps it honest against the schema.
type RequestMatchesSchema = Satisfies<AcquireToolRequest, z.input<typeof AcquireToolRequestSchema>>; // eslint-disable-line @typescript-eslint/no-unused-vars

/**
 * Builds the request used by the extension's own "install this tool" commands.
 *
 * Those commands are how a user asks for the newest tool, so they force the
 * install rather than stopping at a merely acceptable version, and they show
 * their progress.
 */
export function userToolRequest(toolId: ToolId): AcquireToolRequest {
    return {
        toolId,
        requestingExtensionId: ExtensionId,
        force: true,
        showProgressNotification: true,
        revealInstallTask: true,
    };
}

/**
 * Validates a request that crossed the command boundary from another
 * extension, and pairs it with the installer that will service it.
 *
 * @throws When any field is missing, malformed, or names a tool that has no
 *   registered installer.
 */
export function validateAcquireToolRequest(
    input: unknown,
    installers: readonly ToolInstaller[],
): { request: NormalizedToolRequest, installer: ToolInstaller } {
    const result = AcquireToolRequestSchema.safeParse(input);
    if (!result.success) {
        const detail = result.error.issues
            .map(issue => issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message)
            .join('; ');
        throw new Error(`Invalid tool request. ${detail}`);
    }

    const request = result.data;
    const installer = installers.find(candidate => candidate.id === request.toolId);
    if (!installer) {
        // A tool id can be declared before its installer exists, so name the
        // ones that are actually available rather than calling the id invalid.
        throw new Error(
            `${request.toolId} cannot be installed by this version of the extension. Available tools: ${installers.map(i => i.id).join(', ')}.`,
        );
    }

    return { request, installer };
}

/** Default {@linkcode IToolService}, dispatching to the registered {@linkcode ToolInstaller}s. */
@injectable()
export class ToolService implements IToolService {
    /** At most one install per tool may be in flight; see {@linkcode acquireCore}. */
    private readonly installs = new InflightMap<void>();
    private readonly resolvedPaths = new Map<ToolId, string>();

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IProcessExecutor) private readonly processExecutor: IProcessExecutor,
        @multiInject(IToolInstaller) private readonly installers: readonly ToolInstaller[],
    ) { }

    /** @inheritdoc */
    public acquire(request: AcquireToolRequest): Promise<AcquireToolResult> {
        const { request: validated, installer } = validateAcquireToolRequest(request, this.installers);
        return this.acquireCore(installer, validated, validated.versionRange ?? installer.defaultVersionRange);
    }

    /** @inheritdoc */
    public getResolvedPath(toolId: ToolId): string | undefined {
        return this.resolvedPaths.get(toolId);
    }

    private async acquireCore(
        installer: ToolInstaller,
        request: NormalizedToolRequest,
        versionRange: string | undefined,
    ): Promise<AcquireToolResult> {
        request.progress?.(this.code.l10n.t('Looking for {0}...', installer.displayName));
        const found = await this.resolve(installer, request, versionRange);

        // A caller-managed executable is used as-is or not at all -- it is
        // never installed over, so `force` does not apply to it.
        if (request.existingPath) {
            if (!found.satisfying) {
                throw new Error(this.code.l10n.t(
                    'The specified {0} executable is missing, or does not satisfy version "{1}".',
                    installer.displayName,
                    versionRange ?? '*',
                ));
            }
            return this.succeed(installer, found.satisfying.executablePath);
        }

        // A forced request resolves first anyway, so the installer can offer
        // the existing install an update instead of a fresh install.
        if (found.satisfying && !request.force) {
            return this.succeed(installer, found.satisfying.executablePath);
        }

        request.progress?.(this.code.l10n.t('Installing {0}...', installer.displayName));
        // Installing mutates machine-wide state, so at most one install per
        // tool runs at a time -- keyed by tool alone, because two callers
        // wanting *different* versions must still not drive the same package
        // manager at once. A caller that arrives mid-install joins the one in
        // flight rather than starting a second, then re-checks below against
        // its own range; an install started for someone else may or may not
        // satisfy it. (Joining also means the first caller's `reveal` wins.)
        await this.installs.getOrRun(installer.id, () => installer.install({
            current: found.satisfying ?? found.rejected,
            requireSignature: request.requireSignature,
            reveal: request.revealInstallTask,
            cancellationToken: request.cancellationToken,
        }));

        request.progress?.(this.code.l10n.t('Verifying {0}...', installer.displayName));
        const installed = await this.resolve(installer, request, versionRange);
        if (!installed.satisfying) {
            throw new Error(this.code.l10n.t(
                '{0} was installed, but no version satisfying "{1}" could be found afterward. Reload the window and try again.',
                installer.displayName,
                versionRange ?? '*',
            ));
        }

        return this.succeed(installer, installed.satisfying.executablePath);
    }

    private succeed(installer: ToolInstaller, executablePath: string): AcquireToolResult {
        this.resolvedPaths.set(installer.id, executablePath);
        return { executablePath };
    }

    /**
     * Looks for a usable executable, preferring the caller's path, then the
     * `PATH`, then the installer's known locations.
     *
     * Reports the first executable that runs even when it does not satisfy
     * {@linkcode versionRange}, so the installer can offer it a self-update.
     */
    private async resolve(
        installer: ToolInstaller,
        request: NormalizedToolRequest,
        versionRange: string | undefined,
    ): Promise<{ satisfying?: ResolvedTool, rejected?: ResolvedTool }> {
        const candidates = request.existingPath
            ? [request.existingPath]
            : [this.processExecutor.resolveExecutable(installer.executableName), ...installer.getKnownPaths()];

        let rejected: ResolvedTool | undefined;
        for (const executablePath of candidates) {
            if (!executablePath || (!request.existingPath && !await fileExists(this.code, this.code.Uri.file(executablePath)))) {
                continue;
            }

            const version = await installer.getVersion(executablePath, request.cancellationToken);
            if (!version) {
                continue;
            }
            if (!versionRange || semver.satisfies(version, versionRange, { includePrerelease: true })) {
                return { satisfying: { executablePath, version } };
            }
            rejected ??= { executablePath, version };
        }

        return { rejected };
    }
}

interface ResolvedTool {
    readonly executablePath: string;
    readonly version: string;
}
