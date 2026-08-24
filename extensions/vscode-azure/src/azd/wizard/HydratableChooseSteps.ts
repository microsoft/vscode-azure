/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChooseLocationStep, ChooseSubscriptionStep, ISubscriptionClientProvider, type ChooseLocationContext, type ChooseSubscriptionContext } from '@microsoft/vscode-azure-azutils';
import { ICodeContext, IOutputChannel } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree, IAzureViewViewItemTree } from '../../services';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * {@linkcode ChooseSubscriptionStep} variant that auto-skips when
 * {@linkcode AzdWizardContext.hydratedSubscriptionId hydratedSubscriptionId}
 * is set (i.e. {@linkcode HydrateAzdInfoStep} found `AZURE_SUBSCRIPTION_ID`
 * in the existing default env) or when a subscription has already been
 * chosen.
 *
 * The injectable constructor assembles the options bag the azutils base class
 * expects from DI services, so the container can build this step directly.
 *
 * @remarks {@linkcode ChooseSubscriptionStep} types
 * {@linkcode shouldPrompt}'s argument as `PickContext<string>` rather than
 * its own `TContext`, but the wizard runtime always passes the full wizard
 * context. The cast is safe.
 */
@injectable()
export class HydratableChooseSubscriptionStep<TContext extends AzdWizardContext & ChooseSubscriptionContext> extends ChooseSubscriptionStep<TContext> {
    public constructor(
        @inject(ICodeContext) ctx: ICodeContext,
        @inject(IAzureViewViewItemTree) tree: IAzureViewViewItemTree,
        @inject(IAzureViewDataTree) dataItemTree: IAzureViewDataTree,
    ) {
        super({ ...ctx, tree, dataItemTree });
    }

    public override shouldPrompt(context: Readonly<TContext>): boolean {
        return !context.hydratedSubscriptionId && !context.subscription;
    }
}

/**
 * {@linkcode ChooseLocationStep} variant that auto-skips when
 * {@linkcode AzdWizardContext.hydratedLocationName hydratedLocationName}
 * is set (or a location has already been chosen).
 */
@injectable()
export class HydratableChooseLocationStep<TContext extends AzdWizardContext & ChooseLocationContext> extends ChooseLocationStep<TContext> {
    public constructor(
        @inject(ICodeContext) ctx: ICodeContext,
        @inject(ISubscriptionClientProvider) subscriptionClientProvider: ISubscriptionClientProvider,
        @inject(IOutputChannel) output: IOutputChannel,
    ) {
        super(ctx, subscriptionClientProvider, output);
    }

    public override shouldPrompt(context: Readonly<TContext>): boolean {
        return !context.hydratedLocationName && !context.location;
    }
}
