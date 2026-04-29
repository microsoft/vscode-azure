/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChooseLocationStep, ChooseSubscriptionStep, type ChooseLocationContext, type ChooseSubscriptionContext } from '@microsoft/vscode-azure-azutils';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * {@linkcode ChooseSubscriptionStep} variant that auto-skips when
 * {@linkcode AzdWizardContext.hydratedSubscriptionId hydratedSubscriptionId}
 * is set (i.e. {@linkcode HydrateAzdInfoStep} found `AZURE_SUBSCRIPTION_ID`
 * in the existing default env) or when a subscription has already been
 * chosen.
 *
 * @remarks {@linkcode ChooseSubscriptionStep} types
 * {@linkcode shouldPrompt}'s argument as `PickContext<string>` rather than
 * its own `TContext`, but the wizard runtime always passes the full wizard
 * context. The cast is safe.
 */
export class HydratableChooseSubscriptionStep<TContext extends AzdWizardContext & ChooseSubscriptionContext> extends ChooseSubscriptionStep<TContext> {
    public override shouldPrompt(context: Readonly<TContext>): boolean {
        return !context.hydratedSubscriptionId && !context.subscription;
    }
}

/**
 * {@linkcode ChooseLocationStep} variant that auto-skips when
 * {@linkcode AzdWizardContext.hydratedLocationName hydratedLocationName}
 * is set (or a location has already been chosen).
 */
export class HydratableChooseLocationStep<TContext extends AzdWizardContext & ChooseLocationContext> extends ChooseLocationStep<TContext> {
    public override shouldPrompt(context: Readonly<TContext>): boolean {
        return !context.hydratedLocationName && !context.location;
    }
}
