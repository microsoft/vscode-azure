/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { command, IOutputChannel, IProcessExecutor, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import type { ToolId } from './ToolService';
import type { ToolInstallOptions, ToolInstaller } from './ToolInstaller';
import {
    getVersionFromOutput,
    npmGlobalBinPaths,
    pathUnder,
    programFilesPaths,
    runInstallMethod,
    type ToolInstallMethod,
} from './toolInstallerHelpers';

/** The `func` executable name. */
export const FuncCommand = 'func';

/**
 * v5 is in preview and is what we install, so accept it and anything newer.
 *
 * A v4 install found on the machine does not satisfy this, and is offered to
 * the install script for an upgrade instead.
 */
const MinFuncVersion = '5.0.0-0';

/**
 * Where the official install scripts put the CLI when no path is given.
 *
 * Both scripts default to `$HOME/.azure-functions` and place the executable
 * directly in it.
 */
const FuncDefaultInstallDir = '.azure-functions';

/** Installs the Azure Functions Core Tools. */
@injectable()
export class FuncInstaller implements ToolInstaller {
    /** @inheritdoc */
    public readonly id: ToolId = 'func';

    /** @inheritdoc */
    public readonly displayName = 'Azure Functions Core Tools';

    /** @inheritdoc */
    public readonly executableName = FuncCommand;

    /** @inheritdoc */
    public readonly defaultVersionRange = `>=${MinFuncVersion}`;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IProcessExecutor) private readonly processExecutor: IProcessExecutor,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
    ) { }

    /** @inheritdoc */
    public getKnownPaths(): readonly string[] {
        const home = process.env.USERPROFILE ?? process.env.HOME;

        if (process.platform === 'win32') {
            return [
                ...pathUnder(home, FuncDefaultInstallDir, 'func.exe'),
                // Where the v4 MSI (and the winget package wrapping it) installs.
                ...programFilesPaths('Microsoft', 'Azure Functions Core Tools', 'func.exe'),
                ...npmGlobalBinPaths(FuncCommand),
            ];
        }

        return [
            ...pathUnder(home, FuncDefaultInstallDir, FuncCommand),
            ...npmGlobalBinPaths(FuncCommand),
        ];
    }

    /** @inheritdoc */
    public getVersion(executablePath: string, cancellationToken?: vscode.CancellationToken): Promise<string | undefined> {
        return getVersionFromOutput(this.processExecutor, executablePath, cancellationToken);
    }

    /** @inheritdoc */
    public install(options: ToolInstallOptions): Promise<void> {
        return runInstallMethod(
            {
                code: this.code,
                processExecutor: this.processExecutor,
                output: this.output,
                displayName: this.displayName,
                executableName: this.executableName,
                manualInstallUrl: 'https://aka.ms/azfunc-install',
            },
            this.getInstallMethods(options),
            options,
        );
    }

    /**
     * Returns the install methods that apply to this system.
     *
     * v5 is preview, so it ships only through the official install scripts --
     * the winget, Chocolatey, Homebrew, and npm packages all still carry v4.
     * That leaves one method per platform.
     *
     * Neither script can establish that what it downloads came from Microsoft,
     * so both are unverified and a `requireSignature` caller is refused.
     */
    private getInstallMethods(options: ToolInstallOptions): readonly ToolInstallMethod[] {
        // The scripts refuse to overwrite an existing install without --force.
        const force = options.current !== undefined;

        if (process.platform === 'win32') {
            // Downloads the script and runs it as a scriptblock so the switches
            // reach its param block. `iex '...'` would not: single quotes do not
            // interpolate, so `iex` would receive the literal `$(irm ...)` text
            // and merely echo the downloaded script. The documented form uses
            // double quotes for that reason; building a scriptblock instead
            // needs no quote characters at all, so nothing here depends on how
            // the task's shell re-quotes the argument.
            const script = `& ([scriptblock]::Create((irm https://aka.ms/func-cli/install.ps1))) -Prerelease${force ? ' -Force' : ''}`;
            return [{
                name: 'install.ps1',
                command: command('powershell')
                    .namedArg('-ExecutionPolicy', 'Bypass')
                    .arg('-Command', script),
                verified: false,
            }];
        }

        return [{
            name: 'install.sh',
            command: command('bash').arg(
                '-c',
                `curl -sSL https://aka.ms/func-cli/install.sh | bash -s -- --prerelease${force ? ' --force' : ''}`,
            ),
            verified: false,
        }];
    }
}
