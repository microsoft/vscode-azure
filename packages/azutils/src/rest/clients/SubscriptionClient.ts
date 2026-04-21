/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    Location,
    SubscriptionClient as SdkSubscriptionClient,
    SubscriptionClientOptionalParams,
    SubscriptionsListLocationsOptionalParams,
} from '@azure/arm-resources-subscriptions';
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { AsyncFactory, IActionExecutor, ICodeContext, IOutputChannel } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import { createAzureClient } from '../createAzureClient';

export type { Location };

/** Factory that creates an {@linkcode ISubscriptionClient} for a given subscription. */
export const ISubscriptionClientProvider: ServiceIdentifier<ISubscriptionClientProvider> = Symbol.for('ISubscriptionClientProvider');
export type ISubscriptionClientProvider = AsyncFactory<ISubscriptionClient, [AzureSubscription]>;

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
 * Wrapper around the Azure SDK {@linkcode SdkSubscriptionClient} that exposes
 * only the methods we use.
 *
 * Use the static {@linkcode create} factory to construct--it lazily imports the
 * SDK to keep load times down.
 */
export class SubscriptionClient implements ISubscriptionClient {
    private static sdk: typeof import('@azure/arm-resources-subscriptions') | undefined;

    private constructor(private readonly inner: SdkSubscriptionClient) { }

    /**
     * Create a new {@linkcode SubscriptionClient} instance. Lazily imports
     * `@azure/arm-resources-subscriptions` on first call.
     */
    public static async create(
        ctx: ICodeContext,
        executor: IActionExecutor,
        output: IOutputChannel,
        subscription: AzureSubscription,
        options?: SubscriptionClientOptionalParams,
    ): Promise<SubscriptionClient> {
        SubscriptionClient.sdk ??= await import('@azure/arm-resources-subscriptions');
        const inner = createAzureClient(
            ctx,
            executor,
            SubscriptionClient.sdk.SubscriptionClient,
            subscription,
            options,
            output,
        );
        return new SubscriptionClient(inner);
    }

    public get subscriptions(): ISubscriptionClient['subscriptions'] {
        return { listLocations: (subscriptionId, options) => this.listLocations(subscriptionId, options) };
    }

    private static readonly locationsCache = new Map<string, Location[]>();
    private async listLocations(subscriptionId: string, options?: SubscriptionsListLocationsOptionalParams): Promise<Location[]> {
        const cacheKey = subscriptionId.toLowerCase(); // TODO: options as part of cache key? Needed for custom/extended locations to work?
        if (SubscriptionClient.locationsCache.has(cacheKey)) {
            return SubscriptionClient.locationsCache.get(cacheKey)!; // eslint-disable-line @typescript-eslint/no-non-null-assertion -- checked above
        }

        const locations: Location[] = [];
        for await (const location of this.inner.subscriptions.listLocations(subscriptionId, options)) {
            locations.push(location);
        }

        SubscriptionClient.locationsCache.set(cacheKey, locations);

        return locations;
    }
}
