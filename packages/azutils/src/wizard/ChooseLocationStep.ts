/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { type ICodeContext, PromptStep, type QuickPickItemWithData, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import type { ISubscriptionClientProvider, Location } from '../rest/clients/SubscriptionClient';

interface ChooseLocationContext {
    readonly subscription: AzureSubscription;
    readonly location?: Location;
}

export class ChooseLocationStep<TContext extends ChooseLocationContext> extends PromptStep<TContext> {
    public constructor(
        private readonly ctx: ICodeContext,
        private readonly subscriptionClientProvider: ISubscriptionClientProvider,
    ) {
        super();
    }

    public async prompt(context: Readonly<TContext>): Promise<Partial<TContext>> {
        const client = await this.subscriptionClientProvider(context.subscription);
        const locations = await client.subscriptions.listLocations(context.subscription.subscriptionId);

        const picks: QuickPickItemWithData<Location>[] = locations
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
