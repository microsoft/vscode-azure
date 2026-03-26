/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, type IVsCode } from '@microsoft/vscode-azure-utils';
import type { CreateFunctionAppContext } from '../CreateFunctionAppContext';

/**
 * Deploys the generated project by invoking the Azure Developer CLI
 * extension's `azure-dev.provision` command on the project directory.
 */
export class DeployStep extends ExecuteStep<CreateFunctionAppContext> {
    public constructor(
        private readonly code: IVsCode,
    ) {
        super();
    }

    public shouldExecute(context: Readonly<CreateFunctionAppContext>): boolean {
        return context.saveOrDeploy === 'deploy' || context.saveOrDeploy === 'saveAndDeploy';
    }

    public async execute(context: CreateFunctionAppContext): Promise<void> {
        await this.code.commands.executeCommand(
            'azure-dev.commands.cli.provision',
            this.code.Uri.file(context.projectDir),
        );
    }
}
