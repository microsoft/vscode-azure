/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, IActionContext, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { ActivityTreeViewId } from '../../constants';
import { ICodeDeploymentDataProvider } from '../../tree/activity/CodeDeploymentDataProvider';
import { IAzdService } from '../AzdService';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Runs `azd deploy` after provisioning.
 *
 * Creates a code deployment activity in the activity view and
 * focuses the activity panel.
 */
@injectable()
export class AzdDeployStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        @inject(IActionContext) private readonly actionContext: IActionContext,
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(ICodeDeploymentDataProvider) private readonly codeProvider: ICodeDeploymentDataProvider,
    ) {
        super();
    }

    public override shouldExecute(context: Readonly<TContext>): boolean {
        return context.deploy === true && !!context.iacFolder;
    }

    /** Deploys every service unless an explicit service name is supplied by a node action. */
    public async execute(context: Readonly<TContext>, service?: string): Promise<void> {
        const handle = this.codeProvider.trackDeployment({ title: 'azd deploy' });

        void this.code.commands.executeCommand(`${ActivityTreeViewId}.focus`);

        try {
            await this.azd.deploy(context.iacFolder!, service); // eslint-disable-line @typescript-eslint/no-non-null-assertion
            handle.complete('Completed');
        } catch (e) {
            handle.complete('Failed', e);
            this.actionContext.errorHandling.suppress = 'display';
            throw e;
        }
    }
}
