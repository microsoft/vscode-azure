/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessMap } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';

/**
 * Remembers which tenant a service has confirmed a subscription is reached
 * through, so a lookup by bare subscription id can start there instead of
 * walking every tenant.
 *
 * A hint is only ever recorded for a tenant that just served a request the
 * previous tenant's token could not, so it is evidence rather than a guess. It
 * is still only a hint: the lookup resolves it to a listed subscription, and
 * falls back to a full walk when that fails.
 */
export class SubscriptionTenantHints {
    private readonly tenants = new CaselessMap<string>();

    /** Record that `subscriptionId` is reached through `tenantId`. */
    public record(subscriptionId: string, tenantId: string): void {
        this.tenants.set(subscriptionId, tenantId);
    }

    /** The tenant last confirmed for `subscriptionId`, if any. */
    public get(subscriptionId: string): string | undefined {
        return this.tenants.get(subscriptionId);
    }
}

/** DI identifier for the {@linkcode SubscriptionTenantHints} singleton. */
export const ISubscriptionTenantHints: ServiceIdentifier<SubscriptionTenantHints> = Symbol.for('ISubscriptionTenantHints');
