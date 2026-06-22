/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep } from '@microsoft/vscode-azure-utils';
import type { IAzdService } from '../AzdService';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Runs `azd down --force --purge` in
 * {@linkcode AzdWizardContext.iacFolder iacFolder}, deleting every resource
 * provisioned for the project's default environment.
 *
 * Skipped when {@linkcode AzdWizardContext.iacFolder iacFolder} is not set
 * (the only prompt, {@linkcode SelectIacFolderStep}, populates it).
 */
export class AzdDownStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        private readonly azd: IAzdService,
    ) {
        super();
    }

    public override shouldExecute(context: Readonly<TContext>): boolean {
        return !!context.iacFolder;
    }

    public async execute(context: Readonly<TContext>): Promise<void> {
        await this.azd.down(context.iacFolder!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    }
}
