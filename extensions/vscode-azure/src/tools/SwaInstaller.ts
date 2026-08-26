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
    npmInstallMethod,
    runInstallMethod,
    type ToolInstallMethod,
} from './toolInstallerHelpers';

/** The `swa` executable name. */
export const SwaCommand = 'swa';

/** npm package backing both install methods below. */
const SwaNpmPackage = '@azure/static-web-apps-cli';

/** v2 is the current major; every package below installs it. */
const MinSwaVersion = '2.0.0';

/**
 * Installs the Azure Static Web Apps CLI.
 *
 * The CLI ships as an npm package, so unlike the other tools it has no Windows
 * package-manager entry -- there is a Homebrew formula, and npm everywhere
 * else.
 */
@injectable()
export class SwaInstaller implements ToolInstaller {
    /** @inheritdoc */
    public readonly id: ToolId = 'swa';

    /** @inheritdoc */
    public readonly displayName = 'Azure Static Web Apps CLI';

    /** @inheritdoc */
    public readonly executableName = SwaCommand;

    /** @inheritdoc */
    public readonly defaultVersionRange = `>=${MinSwaVersion}`;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IProcessExecutor) private readonly processExecutor: IProcessExecutor,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
    ) { }

    /** @inheritdoc */
    public getKnownPaths(): readonly string[] {
        return npmGlobalBinPaths(SwaCommand);
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
                manualInstallUrl: 'https://aka.ms/swa-cli',
            },
            this.getInstallMethods(),
            options,
        );
    }

    /**
     * Returns the install methods that apply to this system, most preferred
     * first.
     *
     * There is no winget or Chocolatey package, so on Windows npm is the only
     * option -- and it cannot verify its publisher. A caller that passes
     * `requireSignature` there is refused rather than quietly downgraded.
     */
    private getInstallMethods(): readonly ToolInstallMethod[] {
        const methods: ToolInstallMethod[] = [];

        // In brew core, so no tap is needed.
        if (process.platform === 'darwin' && this.processExecutor.isOnPath('brew')) {
            methods.push({
                name: 'brew',
                command: command('brew').arg('install', 'static-web-apps-cli'),
                verified: true,
            });
        }

        if (this.processExecutor.isOnPath('npm')) {
            methods.push(npmInstallMethod(SwaNpmPackage));
        }

        return methods;
    }
}
