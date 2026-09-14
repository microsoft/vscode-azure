/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzdService } from '../../../azd/AzdService';
import { ISubscriptionResolver } from '../../../services';
import type { CreateContainerAppContext } from '../CreateContainerAppContext';
import { VerifyContainerAppStart, type VerifyContainerAppStartRequest } from '../VerifyContainerAppStart';

/** Dispatches independent startup verification after an application-image deployment. */
@injectable()
export class VerifyContainerAppStartStep extends ExecuteStep<CreateContainerAppContext> {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(ISubscriptionResolver) private readonly resolveSubscription: ISubscriptionResolver,
    ) {
        super();
    }

    public override shouldExecute(context: Readonly<CreateContainerAppContext>): boolean {
        return context.deploy === true && !!context.iacFolder;
    }

    public async execute(context: Readonly<CreateContainerAppContext>): Promise<void> {
        if (!context.iacFolder || !context.environmentName) {
            throw new Error(this.code.l10n.t('The azd environment is not configured for startup verification.'));
        }
        const subscription = context.subscription ?? (context.hydratedSubscriptionId
            ? await this.resolveSubscription(context.hydratedSubscriptionId) : undefined);
        const values = await this.azd.envGetValues(context.environmentName, context.iacFolder);
        const appName = values.AZURE_CONTAINER_APP_NAME;
        const resourceGroupName = values.AZURE_RESOURCE_GROUP;
        if (!subscription || !appName || !resourceGroupName) {
            throw new Error(this.code.l10n.t('Unable to identify the deployed Container App. Check the azd environment outputs and subscription access.'));
        }
        const request: VerifyContainerAppStartRequest = Object.freeze({
            subscription, resourceGroupName, appName,
        });
        // The command owns its execution scope, clients, and activity until verification finishes.
        void this.code.commands.executeCommand(VerifyContainerAppStart.CommandId, request);
    }
}
