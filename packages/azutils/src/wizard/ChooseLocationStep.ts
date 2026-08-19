/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessSet, type ICodeContext, type IOutputChannel, PromptStep, type QuickPickItemWithData, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import type { AzureSubscription } from '../auth/AzureSubscription';
import type { ISubscriptionClientProvider, Location } from '../rest/clients/SubscriptionClient';

/**
 * Context shape required by {@linkcode ChooseLocationStep}.
 * Callers must ensure their wizard context extends this and have
 * populated {@linkcode subscription} before this step runs.
 */
export interface ChooseLocationContext {
    readonly subscription?: AzureSubscription;
    readonly location?: Location;
    /**
     * Optional allow-list for resources available in only a subset of Azure regions.
     *
     * Matched case-insensitively: the step folds these into a {@linkcode CaselessSet}
     * itself rather than trusting the caller's collection to compare caselessly, since a
     * plain {@linkcode Set} structurally satisfies any read-only set type but compares
     * exactly. Callers therefore need not normalize the casing, and neither side has to
     * match the casing ARM happens to return.
     */
    readonly allowedLocationNames?: Iterable<string>;
}

/**
 * Wizard step that prompts the user to pick an Azure {@linkcode Location}
 * for the subscription on the wizard context. Requires
 * {@linkcode ChooseLocationContext.subscription} to already be set.
 */
export class ChooseLocationStep<TContext extends ChooseLocationContext> extends PromptStep<TContext> {
    public constructor(
        private readonly ctx: ICodeContext,
        private readonly subscriptionClientProvider: ISubscriptionClientProvider,
        private readonly output: IOutputChannel,
    ) {
        super();
    }

    /**
     * @inheritdoc
     * @throws Error if `context.subscription` is not set.
     */
    public async prompt(context: Readonly<TContext>): Promise<Partial<TContext>> {
        if (!context.subscription) {
            throw new Error(this.ctx.code.l10n.t('Subscription is required to choose location'));
        }

        this.output.debug(`[wizard] fetch locations start subscription=${context.subscription.subscriptionId}`);
        const client = this.subscriptionClientProvider(context.subscription);
        const locations = await client.subscriptions.listLocations(context.subscription.subscriptionId);
        this.output.debug(`[wizard] fetch locations done subscription=${context.subscription.subscriptionId} count=${locations.length}`);

        const allowed = context.allowedLocationNames && new CaselessSet(context.allowedLocationNames);
        const picks: QuickPickItemWithData<Location>[] = locations
            .filter(location => !allowed || (!!location.name && allowed.has(location.name)))
            .filter(l => l.name && l.displayName)
            .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''))
            .map(l => ({
                label: l.displayName!, // eslint-disable-line @typescript-eslint/no-non-null-assertion -- filtered above
                description: l.name!,  // eslint-disable-line @typescript-eslint/no-non-null-assertion -- filtered above
                data: l,
            }));

        const choice = await showSmartQuickPick(this.ctx, picks, {
            placeHolder: this.ctx.code.l10n.t('Select a location for the new resource group'),
            showBack: true,
            matchOnDescription: true,
        });

        return { location: choice.data } as Partial<TContext>;
    }
}
