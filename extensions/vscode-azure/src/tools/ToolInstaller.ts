/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import type { ToolId } from './ToolService';

/** Identifier every {@linkcode ToolInstaller} is bound to. */
export const IToolInstaller: ServiceIdentifier<ToolInstaller> = Symbol.for('IToolInstaller');

/** Options passed to {@linkcode ToolInstaller.install}. */
export interface ToolInstallOptions {
    /**
     * The tool that is already present, when one was found but rejected (for
     * example because it is too old). Lets an installer prefer a self-update
     * over a fresh install.
     */
    readonly current?: { readonly executablePath: string, readonly version: string };

    /**
     * When `true`, the installer must throw rather than fall back to a method
     * that cannot verify what it downloads.
     */
    readonly requireSignature: boolean;

    /** When `true`, the installation task's terminal is revealed. */
    readonly reveal: boolean;

    readonly cancellationToken?: vscode.CancellationToken;
}

/**
 * Knows how to find, version-check, and install one tool.
 *
 * How a tool is installed -- which package manager is preferred, which script
 * is used as a fallback, and what each of those can guarantee about the bits it
 * downloads -- is private to the installer.
 */
export interface ToolInstaller {
    readonly id: ToolId;

    /** Name shown in progress and error messages. */
    readonly displayName: string;

    /** The executable to look for on the `PATH`. */
    readonly executableName: string;

    /** Semver range used when the caller does not supply one. */
    readonly defaultVersionRange?: string;

    /**
     * Absolute paths to check when the executable is not on the `PATH`.
     *
     * Package managers frequently install to a location that is not on the
     * current process's `PATH` until it is restarted, so these are what make a
     * freshly installed tool usable in this session.
     */
    getKnownPaths(): readonly string[];

    /**
     * Returns the version of the executable at {@linkcode executablePath}, or
     * `undefined` when it is missing or does not run.
     */
    getVersion(executablePath: string, cancellationToken?: vscode.CancellationToken): Promise<string | undefined>;

    /**
     * Installs or updates the tool, resolving once the installation task exits
     * successfully.
     *
     * @throws When installation fails, or when {@linkcode ToolInstallOptions.requireSignature}
     *   cannot be honored on this system.
     */
    install(options: ToolInstallOptions): Promise<void>;
}
