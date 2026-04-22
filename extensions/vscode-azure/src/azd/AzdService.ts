/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProcessExecutor, IVsCode } from '@microsoft/vscode-azure-utils';
import { composeArgs, withArg, withFlagArg, withNamedArg, type CommandLineArgs } from '@microsoft/vscode-processutils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';

export const IAzdService: ServiceIdentifier<IAzdService> = Symbol.for('IAzdService');

const AzureYamlFileNames = ['azure.yaml', 'azure.yml'];

/** An azd environment entry returned by `azd env list --output json`. */
export interface AzdEnvironment {
    readonly Name: string;
    readonly IsDefault: boolean;
}

export interface IAzdService {
    /**
     * Returns the URI of `azure.yaml` or `azure.yml` in the given
     * directory, or `undefined` if neither exists.
     */
    findAzureYaml(directory: vscode.Uri): Promise<vscode.Uri | undefined>;

    /** Runs `azd init --minimal --no-prompt` in the given directory. */
    init(cwd: vscode.Uri): Promise<void>;

    /** Runs `azd env new` with the given name, location, and subscription. */
    envNew(name: string, location: string, subscriptionId: string, cwd: vscode.Uri): Promise<void>;

    /** Runs `azd env list --output json` and returns the parsed environment list. */
    envList(cwd: vscode.Uri): Promise<AzdEnvironment[]>;

    /**
     * Runs `azd provision` as a foreground VS Code task.
     *
     * @throws if `azure.yaml` / `azure.yml` is not found in `cwd`.
     */
    provision(cwd: vscode.Uri): Promise<void>;
}

/**
 * Wraps {@linkcode IProcessExecutor} to provide a typed interface for
 * invoking the Azure Developer CLI (`azd`). Handles the common
 * `ENOENT` error with an actionable install hint.
 */
@injectable()
export class AzdService implements IAzdService {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IProcessExecutor) private readonly processExecutor: IProcessExecutor,
    ) { }

    public async findAzureYaml(directory: vscode.Uri): Promise<vscode.Uri | undefined> {
        for (const name of AzureYamlFileNames) {
            const fileUri = this.code.Uri.joinPath(directory, name);
            try {
                await this.code.workspace.fs.stat(fileUri);
                return fileUri;
            } catch {
                // file not found -- try next
            }
        }
        return undefined;
    }

    public async init(cwd: vscode.Uri): Promise<void> {
        try {
            await this.processExecutor.spawn({
                execution: 'background',
                command: 'azd',
                args: composeArgs(
                    withArg('init'),
                    withFlagArg('--minimal', true),
                    withFlagArg('--no-prompt', true),
                )(),
                cwd,
            });
        } catch (e) {
            throw wrapEnoent(e);
        }
    }

    public async envNew(name: string, location: string, subscriptionId: string, cwd: vscode.Uri): Promise<void> {
        try {
            await this.processExecutor.spawn({
                execution: 'background',
                command: 'azd',
                args: composeArgs(
                    withArg('env', 'new', name),
                    withNamedArg('--location', location),
                    withNamedArg('--subscription', subscriptionId),
                )(),
                cwd,
            });
        } catch (e) {
            throw wrapEnoent(e);
        }
    }

    public async envList(cwd: vscode.Uri): Promise<AzdEnvironment[]> {
        try {
            const result = await this.processExecutor.spawn<AzdEnvironment[]>({
                execution: 'background',
                command: 'azd',
                args: composeArgs(
                    withArg('env', 'list'),
                    withJsonOutput(),
                )(),
                cwd,
                parseJson: true,
            });
            return result.json;
        } catch (e) {
            throw wrapEnoent(e);
        }
    }

    public async provision(cwd: vscode.Uri): Promise<void> {
        const azureYamlUri = await this.findAzureYaml(cwd);
        if (!azureYamlUri) {
            throw new Error(this.code.l10n.t('Could not find azure.yaml or azure.yml in the project directory.'));
        }

        try {
            await this.processExecutor.spawn({
                execution: 'foreground',
                command: 'azd',
                args: composeArgs(
                    withArg('provision'),
                )(),
                cwd,
                taskName: 'azd provision',
                source: 'azd',
                alwaysRunNew: true,
                focus: true,
            });
        } catch (e) {
            throw wrapEnoent(e);
        }
    }
}

/** Curry function that appends `--output json` to the argument list. */
function withJsonOutput(): (args?: CommandLineArgs) => CommandLineArgs {
    return withNamedArg('--output', 'json');
}

function wrapEnoent(e: unknown): unknown {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return new Error(
            'Azure Developer CLI (azd) was not found. Install it from https://aka.ms/azure-dev/install and ensure it is available on your PATH.',
            { cause: e },
        );
    }
    return e;
}
