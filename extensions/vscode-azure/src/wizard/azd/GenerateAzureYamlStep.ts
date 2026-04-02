/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep } from '@microsoft/vscode-azure-utils';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { isAzdProject } from '../../utils/isAzdProject';
import type { AzdWizardContext } from './AzdWizardContext';

const execFileAsync = promisify(execFile);

/**
 * Generates the `azure.yaml` stub for the project.
 */
export class GenerateAzureYamlStep extends ExecuteStep<AzdWizardContext> {
    public override async shouldExecute(context: Readonly<AzdWizardContext>): Promise<boolean> {
        if (!context.iacFolder) {
            return false;
        }

        return !(await isAzdProject(context.iacFolder));
    }

    public async execute(context: AzdWizardContext): Promise<void> {
        await execFileAsync('azd', ['init', '--minimal', '--no-prompt'], { cwd: context.iacFolder });
    }
}
