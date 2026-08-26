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
    pathUnder,
    runInstallMethod,
    type ToolInstallMethod,
} from './toolInstallerHelpers';

/** The `func` executable name. */
export const FuncCommand = 'func';

/** npm package backing the npm install method. */
const FuncNpmPackage = 'azure-functions-core-tools';

/**
 * v4 is the supported major: v3 and earlier are out of support, and every
 * package below installs v4, so accepting an older one would leave the caller
 * with a tool the publisher no longer services.
 */
const MinFuncVersion = '4.0.0';

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
        const executable = process.platform === 'win32' ? 'func.exe' : FuncCommand;

        if (process.platform === 'win32') {
            return [
                // Where the MSI (and the winget package wrapping it) installs.
                ...pathUnder(process.env.ProgramFiles, 'Microsoft', 'Azure Functions Core Tools', executable),
                ...pathUnder(process.env['ProgramFiles(x86)'], 'Microsoft', 'Azure Functions Core Tools', executable),
                ...npmGlobalBinPaths(FuncCommand),
            ];
        }

        return npmGlobalBinPaths(FuncCommand);
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
            this.getInstallMethods(),
            options,
        );
    }

    /**
     * Returns the install methods that apply to this system, most preferred
     * first. npm is last everywhere: it is the only option on Linux, but on the
     * other platforms a native package manager both verifies what it installs
     * and does not depend on a Node install the user may not have.
     */
    private getInstallMethods(): readonly ToolInstallMethod[] {
        const methods: ToolInstallMethod[] = [];

        if (process.platform === 'win32') {
            if (this.processExecutor.isOnPath('winget')) {
                methods.push({
                    name: 'winget',
                    command: command('winget')
                        .arg('install', 'Microsoft.Azure.FunctionsCoreTools', '--accept-source-agreements'),
                    verified: true,
                });
            }
            if (this.processExecutor.isOnPath('choco')) {
                methods.push({
                    name: 'choco',
                    command: command('choco').arg('upgrade', FuncNpmPackage),
                    verified: true,
                });
            }
        } else if (process.platform === 'darwin' && this.processExecutor.isOnPath('brew')) {
            // Fully qualified so brew taps `azure/functions` itself rather than
            // needing a separate tap step; the formula is not in brew core.
            methods.push({
                name: 'brew',
                command: command('brew').arg('install', 'azure/functions/azure-functions-core-tools@4'),
                verified: true,
            });
        }

        if (this.processExecutor.isOnPath('npm')) {
            methods.push(npmInstallMethod(FuncNpmPackage));
        }

        return methods;
    }
}
