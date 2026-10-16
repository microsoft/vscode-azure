/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureListingCache, type AzureListingCache } from '@microsoft/vscode-azure-azutils';
import { Everything } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Discards everything the resources view has cached and re-fetches it.
 *
 * This is the one place that clears the account -> tenant -> subscription
 * listings outright. Nothing does so on the user's behalf, because re-earning
 * them costs a token and a round trip per tenant; here the user asked, and a
 * refresh that could not pick up a newly created subscription would not be a
 * refresh.
 */
@injectable()
export class RefreshResourcesView implements ManagedCommand {
    /** Marks tree items that support the shared refresh action. */
    public static readonly ContextValue = 'refreshResource';

    public constructor(
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
        @inject(IAzureListingCache) private readonly listings: AzureListingCache,
    ) { }

    /** @inheritdoc */
    public execute(): void {
        this.listings.clear();
        this.cache.invalidate(Everything);
    }
}
