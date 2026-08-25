/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fileExists, InflightMap, IProcessExecutor, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable, multiInject, type ServiceIdentifier } from 'inversify';
import * as path from 'node:path';
import * as semver from 'semver';
import type * as vscode from 'vscode';
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

/** Tools that can be acquired. */
export type ToolId = 'azd';

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
     * if no acceptable one is found.
     *
     * Concurrent requests for the same tool and version range share a single
     * installation, so callers cannot race each other's package manager. A
     * shared installation follows the cancellation of whichever request started
     * it.
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
 * Builds the request used by the extension's own "install this tool" commands,
 * which want the tool's own default version range and visible progress.
 */
export function userToolRequest(toolId: ToolId): AcquireToolRequest {
    return {
        toolId,
        requestingExtensionId: ExtensionId,
        showProgressNotification: true,
        revealInstallTask: true,
    };
}

/**
 * Validates a request that crossed the command boundary from another
 * extension, and pairs it with the installer that will service it.
 *
 * @throws When any field is missing, malformed, or unsupported.
 */
export function validateAcquireToolRequest(
    input: unknown,
    installers: readonly ToolInstaller[],
): { request: AcquireToolRequest, installer: ToolInstaller } {
    // TODO: Replace these hand-written guards with schema validation (e.g. Zod)
    // if the request grows per-tool option shapes.
    if (typeof input !== 'object' || input === null) {
        throw new Error('The tool request must be an object.');
    }

    const request = input as Record<string, unknown>;
    const installer = installers.find(candidate => candidate.id === request.toolId);
    if (!installer) {
        throw new Error(`Unsupported tool: ${String(request.toolId)}.`);
    }
    if (typeof request.requestingExtensionId !== 'string' || !/^[^.\s]+\.[^.\s]+$/.test(request.requestingExtensionId)) {
        throw new Error('requestingExtensionId must be in publisher.name form.');
    }
    if (request.versionRange !== undefined
        && (typeof request.versionRange !== 'string' || semver.validRange(request.versionRange) === null)) {
        throw new Error('versionRange must be a valid semver range.');
    }
    if (request.existingPath !== undefined
        && (typeof request.existingPath !== 'string' || !path.isAbsolute(request.existingPath))) {
        throw new Error('existingPath must be an absolute path.');
    }
    for (const flag of ['requireSignature', 'showProgressNotification', 'revealInstallTask'] as const) {
        if (request[flag] !== undefined && typeof request[flag] !== 'boolean') {
            throw new Error(`${flag} must be a boolean.`);
        }
    }
    if (request.progress !== undefined && typeof request.progress !== 'function') {
        throw new Error('progress must be a function.');
    }

    return { request: request as unknown as AcquireToolRequest, installer };
}

/** Default {@linkcode IToolService}, dispatching to the registered {@linkcode ToolInstaller}s. */
@injectable()
export class ToolService implements IToolService {
    private readonly inflight = new InflightMap<AcquireToolResult>();
    private readonly resolvedPaths = new Map<ToolId, string>();

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IProcessExecutor) private readonly processExecutor: IProcessExecutor,
        @multiInject(IToolInstaller) private readonly installers: readonly ToolInstaller[],
    ) { }

    /** @inheritdoc */
    public acquire(request: AcquireToolRequest): Promise<AcquireToolResult> {
        const { request: validated, installer } = validateAcquireToolRequest(request, this.installers);
        const versionRange = validated.versionRange ?? installer.defaultVersionRange;

        // A caller-supplied path is never installed to, so it needs no lock.
        if (validated.existingPath) {
            return this.acquireCore(installer, validated, versionRange);
        }

        return this.inflight.getOrRun(
            `${installer.id}|${versionRange ?? '*'}`,
            () => this.acquireCore(installer, validated, versionRange),
        );
    }

    /** @inheritdoc */
    public getResolvedPath(toolId: ToolId): string | undefined {
        return this.resolvedPaths.get(toolId);
    }

    private async acquireCore(
        installer: ToolInstaller,
        request: AcquireToolRequest,
        versionRange: string | undefined,
    ): Promise<AcquireToolResult> {
        request.progress?.(this.code.l10n.t('Looking for {0}...', installer.displayName));
        const found = await this.resolve(installer, request, versionRange);
        if (found.satisfying) {
            return this.succeed(installer, found.satisfying.executablePath);
        }

        if (request.existingPath) {
            throw new Error(this.code.l10n.t(
                'The specified {0} executable is missing, or does not satisfy version "{1}".',
                installer.displayName,
                versionRange ?? '*',
            ));
        }

        request.progress?.(this.code.l10n.t('Installing {0}...', installer.displayName));
        await installer.install({
            current: found.rejected,
            requireSignature: request.requireSignature ?? false,
            reveal: request.revealInstallTask ?? false,
            cancellationToken: request.cancellationToken,
        });

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
        request: AcquireToolRequest,
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
