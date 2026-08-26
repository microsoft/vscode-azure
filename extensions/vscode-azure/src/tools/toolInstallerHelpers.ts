/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, command, type CommandLineArgs, type IOutputChannel, type IProcessExecutor, type IVsCode } from '@microsoft/vscode-azure-utils';
import * as path from 'node:path';
import * as semver from 'semver';
import type * as vscode from 'vscode';
import type { ToolInstallOptions } from './ToolInstaller';

/**
 * One way of installing a tool.
 *
 * `verified` records whether the method establishes that what it downloads
 * really came from the publisher it claims. Package managers that check a
 * signature or a pinned hash do; fetching a script or a tarball over HTTPS
 * proves only that the transport was not tampered with.
 */
export interface ToolInstallMethod {
    /** Named in the warning shown when an unverified method is used. */
    readonly name: string;
    readonly command: CommandLineArgs;
    readonly verified: boolean;
}

/** Services an installer needs to run an install method. */
export interface ToolInstallContext {
    readonly code: IVsCode;
    readonly processExecutor: IProcessExecutor;
    readonly output: IOutputChannel;
    readonly displayName: string;
    readonly executableName: string;
    /** Shown when nothing on this system can install the tool. */
    readonly manualInstallUrl: string;
}

/** A path under {@linkcode root}, or nothing when `root` is unset. */
export function pathUnder(root: string | undefined, ...segments: string[]): string[] {
    return root ? [path.join(root, ...segments)] : [];
}

/**
 * Well-known Windows install roots, defaulting to the conventional locations
 * when the environment does not name them.
 *
 * The fallbacks matter for more than tidiness: a test that fakes
 * `process.platform` runs on a host whose environment has no `ProgramFiles`,
 * and a Windows process can legitimately be missing `ProgramFiles(x86)`.
 * Falling back keeps a known path from silently vanishing in either case.
 */
export function programFilesPaths(...segments: string[]): string[] {
    const roots = [
        process.env.ProgramFiles ?? 'C:\\Program Files',
        process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    ];

    return [...new Set(roots)].map(root => path.win32.join(root, ...segments));
}

/**
 * The directory npm installs global packages into, as far as it can be known
 * without running npm.
 *
 * A user who has moved their npm prefix is found through the `PATH` instead;
 * this only has to cover the default, for the window after an install but
 * before the extension host's `PATH` is refreshed.
 */
export function npmGlobalBinPaths(executableName: string): string[] {
    if (process.platform === 'win32') {
        // npm writes a `.cmd` shim beside the package on Windows.
        return process.env.APPDATA
            ? [path.win32.join(process.env.APPDATA, 'npm', `${executableName}.cmd`)]
            : [];
    }

    return [
        ...pathUnder(process.env.HOME, '.npm-global', 'bin', executableName),
        `/usr/local/bin/${executableName}`,
        ...(process.platform === 'darwin' ? [`/opt/homebrew/bin/${executableName}`] : []),
    ];
}

/**
 * Installing a global npm package.
 *
 * Marked unverified: npm checks the tarball against the registry's hash over
 * HTTPS, which detects tampering in transit but does not establish that the
 * publisher is who they claim. Callers that demand verification are better
 * served by a platform package manager, so this belongs last.
 */
export function npmInstallMethod(packageName: string): ToolInstallMethod {
    return {
        name: 'npm',
        // `npm install -g` upgrades a package that is already present.
        command: command('npm').arg('install', '-g', packageName),
        verified: false,
    };
}

/**
 * Runs `<executablePath> --version` and returns the semver it reports.
 *
 * For tools that print a bare version rather than structured output. Returns
 * `undefined` when the executable is missing, fails, or prints something no
 * version can be read from -- all of which mean "not usable" to a caller.
 *
 * @throws {@linkcode CancellationError} when cancelled. A cancelled probe means
 *   "we stopped looking", not "not installed", and swallowing it would let the
 *   caller carry on and install something.
 */
export async function getVersionFromOutput(
    processExecutor: IProcessExecutor,
    executablePath: string,
    cancellationToken?: vscode.CancellationToken,
): Promise<string | undefined> {
    let stdout: string;
    try {
        const result = await processExecutor.spawn({
            execution: 'background',
            command: command(executablePath).arg('--version'),
        }, cancellationToken);
        stdout = result.stdout;
    } catch (error) {
        if (CancellationError.test(error)) {
            throw error;
        }
        return undefined;
    }

    // Take the last non-empty line: some CLIs print a banner or an update
    // notice first, but the version itself is what they end with.
    const line = stdout.split('\n').map(part => part.trim()).filter(Boolean).at(-1);
    if (!line) {
        return undefined;
    }

    // Prefer an exact match so a decorated line cannot be mistaken for one;
    // fall back to coercion for tools that prefix a `v` or trail a build tag.
    return semver.valid(line) ?? semver.coerce(line)?.version;
}

/**
 * Runs the most preferred applicable install method, as a foreground task.
 *
 * @throws When no method applies on this system, or when
 *   {@linkcode ToolInstallOptions.requireSignature} is set and no applicable
 *   method can verify what it downloads.
 */
export async function runInstallMethod(
    context: ToolInstallContext,
    methods: readonly ToolInstallMethod[],
    options: ToolInstallOptions,
): Promise<void> {
    const method = options.requireSignature
        ? methods.find(candidate => candidate.verified)
        : methods[0];

    if (!method) {
        throw new Error(context.code.l10n.t(
            'No way to install {0} is available on this system. Install it manually from {1}.',
            context.displayName,
            context.manualInstallUrl,
        ));
    }

    if (!method.verified) {
        context.output.warn(context.code.l10n.t(
            '[{0}] Installing {1} via {2}, which cannot verify the authenticity of what it downloads.',
            context.executableName,
            context.displayName,
            method.name,
        ));
    }

    await context.processExecutor.spawn({
        execution: 'foreground',
        command: method.command,
        name: context.code.l10n.t('Install {0}', context.displayName),
        source: context.executableName,
        focus: options.reveal,
    }, options.cancellationToken);
}
