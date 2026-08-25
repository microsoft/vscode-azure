/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, command, type IProcessExecutor } from '@microsoft/vscode-azure-utils';
import * as path from 'node:path';
import * as semver from 'semver';
import type * as vscode from 'vscode';
import type { ToolDefinition, ToolInstallContext, ToolInstallStrategy, ToolRuntime } from './ToolAcquisition';

const AzdCommand = 'azd';
const MinAzdUpdateVersion = '1.23.14';

interface AzdVersionResult {
    readonly azd: {
        readonly version: string;
    };
}

/** Creates the Azure Developer CLI definition used by the acquisition service. */
export function createAzdToolDefinition(): ToolDefinition {
    return {
        id: 'azd',
        displayName: 'Azure Developer CLI',
        executableName: AzdCommand,
        learnMoreUrl: 'https://aka.ms/azd',
        getKnownPaths: getKnownAzdPaths,
        probeVersion: probeAzdVersion,
        getInstallStrategies: getAzdInstallStrategies,
    };
}

function getKnownAzdPaths(runtime: ToolRuntime): readonly string[] {
    const result: string[] = [];
    const home = runtime.env.USERPROFILE ?? runtime.env.HOME;

    if (runtime.platform === 'win32') {
        if (runtime.env.LOCALAPPDATA) {
            result.push(path.join(runtime.env.LOCALAPPDATA, 'Programs', 'Azure Dev CLI', 'azd.exe'));
        }
        if (runtime.env.ProgramFiles) {
            result.push(path.join(runtime.env.ProgramFiles, 'Azure Dev CLI', 'azd.exe'));
        }
        if (home) {
            result.push(path.join(home, '.azd', 'bin', 'azd.exe'));
        }
    } else {
        if (home) {
            result.push(path.join(home, '.azd', 'bin', 'azd'));
        }
        result.push('/usr/local/bin/azd');
        if (runtime.platform === 'darwin') {
            result.push('/opt/homebrew/bin/azd');
        }
    }

    return result;
}

async function probeAzdVersion(
    executablePath: string,
    processExecutor: IProcessExecutor,
    cancellation?: vscode.CancellationToken | AbortSignal,
): Promise<string | undefined> {
    try {
        const result = await processExecutor.spawn<AzdVersionResult>({
            execution: 'background',
            command: command(executablePath)
                .arg('version')
                .namedArg('--output', 'json'),
            parseJson: true,
        }, cancellation);
        return semver.valid(result.json.azd.version) ?? undefined;
    } catch (error) {
        if (CancellationError.test(error)) {
            throw error;
        }
        return undefined;
    }
}

function getAzdInstallStrategies(context: ToolInstallContext): readonly ToolInstallStrategy[] {
    const strategies: ToolInstallStrategy[] = [];
    if (context.current && semver.gte(context.current.version, MinAzdUpdateVersion)) {
        strategies.push({
            method: 'azdUpdate',
            command: command(context.current.executablePath).arg('update'),
            signatureVerified: true,
        });
    }

    if (context.runtime.platform === 'win32') {
        if (context.processExecutor.isOnPath('winget')) {
            strategies.push({
                method: 'winget',
                command: command('winget').arg('install', 'microsoft.azd'),
                signatureVerified: true,
            });
        }
        if (context.processExecutor.isOnPath('choco')) {
            strategies.push({
                method: 'chocolatey',
                command: command('choco').arg('upgrade', 'azd'),
                signatureVerified: true,
            });
        }
        strategies.push({
            method: 'officialScript',
            command: command('powershell')
                .namedArg('-ExecutionPolicy', 'AllSigned')
                .arg('-c', 'Invoke-RestMethod \'https://aka.ms/install-azd.ps1\' | Invoke-Expression'),
            signatureVerified: false,
        });
    } else if (context.runtime.platform === 'darwin') {
        if (context.processExecutor.isOnPath('brew')) {
            strategies.push({
                method: 'homebrew',
                command: command('brew').arg('install', 'azure/azd/azd'),
                signatureVerified: true,
            });
        }
        strategies.push(createShellInstallStrategy());
    } else if (context.runtime.platform === 'linux') {
        strategies.push(createShellInstallStrategy());
    }

    return strategies;
}

function createShellInstallStrategy(): ToolInstallStrategy {
    return {
        method: 'officialScript',
        command: command('bash').arg('-c', 'curl -fsSL \'https://aka.ms/install-azd.sh\' | bash'),
        signatureVerified: false,
    };
}
