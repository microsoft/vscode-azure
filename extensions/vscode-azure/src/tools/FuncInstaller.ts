/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { command, IOutputChannel, IProcessExecutor, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { intersects } from 'semver';
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
 * The default acquisition policy accepts v5 preview and newer versions.
 *
 * Consumers requiring v4 supply their own version range.
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
     * An explicit v4-only range uses the official npm package. The default v5
     * preview policy uses the official install scripts --
     * the winget, Chocolatey, Homebrew, and npm packages all still carry v4.
     * That leaves one method per platform.
     *
     * Neither script can establish that what it downloads came from Microsoft,
     * so both are unverified and a `requireSignature` caller is refused.
     */
    private getInstallMethods(options: ToolInstallOptions): readonly ToolInstallMethod[] {
        if (options.versionRange && intersects(options.versionRange, '>=4.0.0 <5.0.0')
            && !intersects(options.versionRange, '>=5.0.0')) {
            return [{
                name: 'npm',
                command: command('npm').arg('install', '-g', 'azure-functions-core-tools@4', '--unsafe-perm'),
                verified: false,
            }];
        }
        // The scripts refuse to overwrite an existing install without --force.
        const force = options.current !== undefined;

        if (process.platform === 'win32') {
            const args = `-Prerelease${force ? ' -Force' : ''}`;
            return [{
                name: 'install.ps1',
                command: command('powershell')
                    .namedArg('-ExecutionPolicy', 'Bypass')
                    .arg('-Command', `Invoke-Expression ('& { ' + (Invoke-RestMethod 'https://aka.ms/func-cli/install.ps1') + ' } ${args}')`),
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
