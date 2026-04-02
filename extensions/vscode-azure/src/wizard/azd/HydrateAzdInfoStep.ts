/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import { getWorkspaceFolder, PromptStep } from '@microsoft/vscode-azure-utils';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { isAzdProject } from '../../utils/isAzdProject';
import type { AzdWizardContext } from './AzdWizardContext';

const execFileAsync = promisify(execFile);

/**
 * Silently hydrates the wizard context with existing azd project
 * information found in the workspace root (azure.yaml and
 * `azd env list`). Never actually prompts the user.
 */
// TODO: Replace with AZD extension API when available
export class HydrateAzdInfoStep<TContext extends AzdWizardContext> extends PromptStep<TContext> {
    public constructor(
        private readonly code: IVsCode,
    ) {
        super();
    }

    public async prompt(): Promise<Partial<TContext>> {
        const workspaceRoot = (await getWorkspaceFolder(this.code))?.uri.fsPath;
        if (!workspaceRoot) {
            return {} as Partial<TContext>;
        }

        const result: Record<string, unknown> = {};

        // Check for azure.yaml / azure.yml to detect an existing azd project
        if (await isAzdProject(workspaceRoot)) {
            result.iacFolder = workspaceRoot;
        }

        // Find the default azd environment via CLI
        const envName = await this.findDefaultEnvironment(workspaceRoot);
        if (envName) {
            result.environmentName = envName;
        }

        return result as Partial<TContext>;
    }

    private async findDefaultEnvironment(cwd: string): Promise<string | undefined> {
        try {
            // TODO: Replace with AZD extension API when available
            const { stdout } = await execFileAsync('azd', ['env', 'list', '--output', 'json'], { cwd });
            const envs: AzdEnvEntry[] = JSON.parse(stdout) as AzdEnvEntry[];
            const defaultEnv = envs.find(e => e.IsDefault);
            return defaultEnv?.Name;
        } catch {
            // azd not installed or no environments — ignore
        }
        return undefined;
    }
}

interface AzdEnvEntry {
    readonly Name: string;
    readonly IsDefault: boolean;
}
