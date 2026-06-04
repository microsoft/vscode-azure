/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep } from '@microsoft/vscode-azure-utils';
import type { IAzdService } from '../AzdService';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Generates the `azure.yaml` stub for the project.
 */
export class GenerateAzureYamlStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        private readonly azd: IAzdService,
    ) {
        super();
    }

    public override async shouldExecute(context: Readonly<TContext>): Promise<boolean> {
        if (!context.iacFolder) {
            return false;
        }

        // Trust the hydration flag when present (set by HydrateAzdInfoStep for
        // the `deploy` job) so we don't double-stat. The `createNew` job skips
        // hydration, so fall through to a live check on the temp folder.
        if (context.hasAzureYaml === true) {
            return false;
        }

        return (await this.azd.findAzureYaml(context.iacFolder)).length === 0;
    }

    public async execute(context: Readonly<TContext>): Promise<void> {
        await this.azd.init(context.iacFolder!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    }
}
