/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createSubscription, type SubscriptionClientOptionalParams, type SubscriptionContext } from '@azure/arm-resources-subscriptions/api';
import { listLocations as sdkListLocations, type SubscriptionsListLocationsOptionalParams } from '@azure/arm-resources-subscriptions/api/subscriptions';
import type {
    Location,
} from '@azure/arm-resources-subscriptions/models';
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { IActionExecutor, ICodeContext, SyncFactory } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import { createAzureRestClient } from '../createAzureClient';

export type { Location };

/** Factory that creates an {@linkcode ISubscriptionClient} for a given subscription. */
export const ISubscriptionClientProvider: ServiceIdentifier<ISubscriptionClientProvider> = Symbol.for('ISubscriptionClientProvider');
export type ISubscriptionClientProvider = SyncFactory<ISubscriptionClient, [AzureSubscription]>;

/**
 * Interface describing the subscription-level APIs we use.
 * Designed so that tests can provide a mock implementation directly.
 */
export interface ISubscriptionClient {
    readonly subscriptions: {
        listLocations(subscriptionId: string, options?: SubscriptionsListLocationsOptionalParams): Promise<Location[]>;
    };
}

/**
 * Wrapper around the `@azure/arm-resources-subscriptions` REST-style SDK that
 * adapts free functions into the `client.subscriptions.*` pattern.
 *
 * Use the static {@linkcode create} factory to construct.
 */
export class SubscriptionClient implements ISubscriptionClient {
    private constructor(private readonly inner: SubscriptionContext) { }

    /**
     * Create a new {@linkcode SubscriptionClient} instance.
     */
    public static create(
        ctx: ICodeContext,
        executor: IActionExecutor,
        subscription: AzureSubscription,
        options?: SubscriptionClientOptionalParams,
    ): SubscriptionClient {
        const context = createAzureRestClient(
            ctx,
            executor,
            createSubscription,
            subscription,
            options,
        );
        return new SubscriptionClient(context);
    }

    public get subscriptions(): ISubscriptionClient['subscriptions'] {
        return { listLocations: (subscriptionId, options) => this.listLocations(subscriptionId, options) };
    }

    private static readonly locationsCache = new Map<string, Location[]>();
    private async listLocations(subscriptionId: string, options?: SubscriptionsListLocationsOptionalParams): Promise<Location[]> {
        const extendedSuffix = options?.includeExtendedLocations ? ':ext' : '';
        const cacheKey = `${subscriptionId.toLowerCase()}${extendedSuffix}`;
        if (SubscriptionClient.locationsCache.has(cacheKey)) {
            return SubscriptionClient.locationsCache.get(cacheKey)!; // eslint-disable-line @typescript-eslint/no-non-null-assertion -- checked above
        }

        const locations: Location[] = [];
        for await (const location of sdkListLocations(this.inner, subscriptionId, options)) {
            locations.push(location);
        }

        SubscriptionClient.locationsCache.set(cacheKey, locations);

        return locations;
    }
}
