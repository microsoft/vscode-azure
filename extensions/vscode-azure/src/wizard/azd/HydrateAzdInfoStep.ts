/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import { getWorkspaceFolder, PromptStep } from '@microsoft/vscode-azure-utils';
import { execAzd, findAzureYaml } from '../../utils/azdUtils';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Silently hydrates the wizard context with existing azd project
 * information found in the workspace root (azure.yaml and
 * `azd env list`). Never actually prompts the user.
 */
export class HydrateAzdInfoStep<TContext extends AzdWizardContext> extends PromptStep<TContext> {
    public constructor(
        private readonly code: IVsCode,
    ) {
        super();
    }

    public async prompt(): Promise<Partial<TContext>> {
        const workspaceFolder = await getWorkspaceFolder(this.code);
        if (!workspaceFolder) {
            return {};
        }

        const result: Record<string, unknown> = {};

        // Check for azure.yaml / azure.yml to detect an existing azd project
        if (await findAzureYaml(this.code, workspaceFolder.uri)) {
            result.iacFolder = workspaceFolder.uri;
        }

        // Find the default azd environment via CLI
        const envName = await this.findDefaultEnvironment(workspaceFolder.uri.fsPath);
        if (envName) {
            result.environmentName = envName;
        }

        return result as Partial<TContext>;
    }

    private async findDefaultEnvironment(cwd: string): Promise<string | undefined> {
        try {
            // TODO: future: Replace with AZD extension API when available
            const { stdout } = await execAzd(['env', 'list', '--output', 'json'], cwd);
            const envs: AzdEnvEntry[] = JSON.parse(stdout) as AzdEnvEntry[];
            const defaultEnv = envs.find(e => e.IsDefault);
            return defaultEnv?.Name;
        } catch {
            // azd not installed or no environments -- ignore
        }
        return undefined;
    }
}

interface AzdEnvEntry {
    readonly Name: string;
    readonly IsDefault: boolean;
}
