/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { command, IOutputChannel, IProcessExecutor, IVsCode, type CommandLineArgs } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import * as path from 'node:path';
import * as semver from 'semver';
import type * as vscode from 'vscode';
import { AzdCommand, MinAzdVersion } from '../azd/AzdService';
import type { ToolId } from './ToolService';
import type { ToolInstallOptions, ToolInstaller } from './ToolInstaller';

/** Minimum `azd` version that supports the `azd update` command. */
const MinAzdUpdateVersion = '1.23.14';

/** Result of `azd version --output json`. */
interface AzdVersionResult {
    readonly azd: { readonly version: string };
}

/**
 * One way of installing `azd`.
 *
 * `verified` records whether the method establishes that what it downloads
 * really came from Microsoft. Package managers do this on the extension's
 * behalf; piping an install script into a shell cannot.
 */
interface AzdInstallMethod {
    readonly name: string;
    readonly command: CommandLineArgs;
    readonly verified: boolean;
}

/** Installs the Azure Developer CLI, preferring package managers over install scripts. */
@injectable()
export class AzdInstaller implements ToolInstaller {
    /** @inheritdoc */
    public readonly id: ToolId = 'azd';

    /** @inheritdoc */
    public readonly displayName = 'Azure Developer CLI';

    /** @inheritdoc */
    public readonly executableName = AzdCommand;

    /** @inheritdoc */
    public readonly defaultVersionRange = `>=${MinAzdVersion}`;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IProcessExecutor) private readonly processExecutor: IProcessExecutor,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
    ) { }

    /** @inheritdoc */
    public getKnownPaths(): readonly string[] {
        const home = process.env.USERPROFILE ?? process.env.HOME;

        const candidates = process.platform === 'win32'
            ? [
                process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Azure Dev CLI', 'azd.exe'),
                process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Azure Dev CLI', 'azd.exe'),
                home && path.join(home, '.azd', 'bin', 'azd.exe'),
            ]
            : [
                home && path.join(home, '.azd', 'bin', 'azd'),
                '/usr/local/bin/azd',
                process.platform === 'darwin' ? '/opt/homebrew/bin/azd' : undefined,
            ];

        return candidates.filter((candidate): candidate is string => !!candidate);
    }

    /** @inheritdoc */
    public async getVersion(executablePath: string, cancellationToken?: vscode.CancellationToken): Promise<string | undefined> {
        try {
            const result = await this.processExecutor.spawn<AzdVersionResult>({
                execution: 'background',
                command: command(executablePath)
                    .arg('version')
                    .namedArg('--output', 'json'),
                parseJson: true,
            }, cancellationToken);
            return semver.valid(result.json.azd.version) ?? undefined;
        } catch {
            return undefined;
        }
    }

    /** @inheritdoc */
    public async install(options: ToolInstallOptions): Promise<void> {
        const methods = this.getInstallMethods(options);
        const method = options.requireSignature
            ? methods.find(candidate => candidate.verified)
            : methods[0];

        if (!method) {
            throw new Error(this.code.l10n.t(
                'No way to install {0} is available on this system. Install it manually from https://aka.ms/azd.',
                this.displayName,
            ));
        }

        if (!method.verified) {
            this.output.warn(`[azd] Installing via ${method.name}, which cannot verify the authenticity of what it downloads.`);
        }

        await this.processExecutor.spawn({
            execution: 'foreground',
            command: method.command,
            name: this.code.l10n.t('Install {0}', this.displayName),
            source: AzdCommand,
            focus: options.reveal,
        }, options.cancellationToken);
    }

    /**
     * Returns the install methods that apply to this system, most preferred
     * first. Updating an existing install is preferred because it never needs a
     * package manager; scripts are last because they cannot verify what they
     * download.
     */
    private getInstallMethods(options: ToolInstallOptions): readonly AzdInstallMethod[] {
        const methods: AzdInstallMethod[] = [];

        if (options.current && semver.gte(options.current.version, MinAzdUpdateVersion)) {
            methods.push({
                name: 'azd update',
                command: command(options.current.executablePath).arg('update'),
                verified: true,
            });
        }

        if (process.platform === 'win32') {
            if (this.processExecutor.isOnPath('winget')) {
                // `winget install` upgrades already-installed packages by
                // default. Source agreements are accepted up front because a
                // profile that has never run winget is otherwise prompted, and
                // an API-driven install does not reveal its terminal for the
                // user to answer.
                methods.push({
                    name: 'winget',
                    command: command('winget')
                        .arg('install', 'microsoft.azd')
                        .flagArg('--accept-source-agreements'),
                    verified: true,
                });
            }
            if (this.processExecutor.isOnPath('choco')) {
                // `choco upgrade` installs if missing and upgrades if already installed
                methods.push({
                    name: 'choco',
                    command: command('choco').arg('upgrade', 'azd'),
                    verified: true,
                });
            }
            methods.push({
                name: 'install-azd.ps1',
                // The command azd's own documentation gives users. It is not
                // treated as verified: execution policy does not apply to
                // `-Command`, so `AllSigned` does not actually gate the piped
                // script, and it is carried only to match that documented form.
                command: command('powershell')
                    .namedArg('-ExecutionPolicy', 'AllSigned')
                    .arg('-c', 'Invoke-RestMethod \'https://aka.ms/install-azd.ps1\' | Invoke-Expression'),
                verified: false,
            });
        } else {
            if (process.platform === 'darwin' && this.processExecutor.isOnPath('brew')) {
                // `brew install` upgrades already-installed packages by default
                methods.push({
                    name: 'brew',
                    command: command('brew').arg('install', 'azure/azd/azd'),
                    verified: true,
                });
            }
            methods.push({
                name: 'install-azd.sh',
                command: command('bash').arg('-c', 'curl -fsSL \'https://aka.ms/install-azd.sh\' | bash'),
                verified: false,
            });
        }

        return methods;
    }
}
