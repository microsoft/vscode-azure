/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, type IActionContext } from '@microsoft/vscode-azure-utils';
import * as crypto from 'crypto';
import { CodeDeploymentDataProvider } from '../../tree/activity/CodeDeploymentDataProvider';
import type { IAzdService } from '../AzdService';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Runs `azd deploy` after provisioning.
 *
 * Creates a code deployment activity in the activity view.
 */
export class AzdDeployStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        private readonly actionContext: IActionContext,
        private readonly azd: IAzdService,
        private readonly codeProvider: CodeDeploymentDataProvider,
    ) {
        super();
    }

    public override shouldExecute(context: Readonly<TContext>): boolean {
        return context.deploy === true && !!context.iacFolder;
    }

    public async execute(context: TContext): Promise<void> {
        const activity = this.codeProvider.trackDeployment({
            id: crypto.randomUUID(),
            status: 'InProgress',
            title: 'azd deploy',
        });

        try {
            await this.azd.deployWithCapture(context.iacFolder!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
            activity.status = 'Completed';
            activity.endTime = new Date();
        } catch (e) {
            activity.status = 'Failed';
            activity.endTime = new Date();
            this.actionContext.errorHandling.suppressDisplay = true;
            throw e;
        }
    }
}
