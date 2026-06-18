/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createSubscription, type SubscriptionClientOptionalParams, type SubscriptionContext } from '@azure/arm-resources-subscriptions/api';
import { listLocations as sdkListLocations, list as sdkListSubscriptions, type SubscriptionsListLocationsOptionalParams, type SubscriptionsListOptionalParams } from '@azure/arm-resources-subscriptions/api/subscriptions';
import { list as sdkListTenants, type TenantsListOptionalParams } from '@azure/arm-resources-subscriptions/api/tenants';
import type {
    Location,
    Subscription,
    TenantIdDescription,
} from '@azure/arm-resources-subscriptions/models';
import type { TokenCredential } from '@azure/core-auth';
import type { IActionExecutor, ICodeContext, Page, SyncFactory } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { AzureSubscription } from '../../auth/AzureSubscription';
import type { EnvironmentLike } from '../../auth/Environment';
import { createArmRestClient } from '../createAzureClient';
import { toPages } from '../toPages';

export type { Location, Subscription, TenantIdDescription };

/** Factory that creates an {@linkcode ISubscriptionClient} for a given subscription. */
export const ISubscriptionClientProvider: ServiceIdentifier<ISubscriptionClientProvider> = Symbol.for('ISubscriptionClientProvider');
export type ISubscriptionClientProvider = SyncFactory<ISubscriptionClient, [AzureSubscription]>;

/**
 * Interface describing the `@azure/arm-resources-subscriptions` APIs we use.
 * Designed so that tests can provide a mock implementation directly.
 */
export interface ISubscriptionClient {
    readonly tenants: {
        list(options?: TenantsListOptionalParams): AsyncIterable<Page<TenantIdDescription>>;
    };
    readonly subscriptions: {
        list(options?: SubscriptionsListOptionalParams): AsyncIterable<Page<Subscription>>;
        listLocations(subscriptionId: string, options?: SubscriptionsListLocationsOptionalParams): Promise<Location[]>;
    };
}

/**
 * Wrapper around the `@azure/arm-resources-subscriptions` REST-style SDK that
 * adapts free functions into the `client.tenants.*` / `client.subscriptions.*`
 * pattern.
 *
 * Not subscription-scoped: the SDK context is created from a credential plus the
 * environment's ARM endpoint, and the subscription ID is supplied per-call where
 * required (e.g. {@linkcode ISubscriptionClient.subscriptions listLocations}).
 *
 * Use the static {@linkcode create} factory to construct.
 */
export class SubscriptionClient implements ISubscriptionClient {
    private constructor(private readonly inner: SubscriptionContext) { }

    /**
     * Create a new {@linkcode SubscriptionClient} instance.
     *
     * @param credential - The token credential used to authenticate requests.
     * @param environment - The Azure environment whose ARM endpoint is used.
     */
    public static create(
        ctx: ICodeContext,
        executor: IActionExecutor,
        credential: TokenCredential,
        environment: EnvironmentLike,
        options?: SubscriptionClientOptionalParams,
    ): SubscriptionClient {
        const context = createArmRestClient(
            ctx,
            executor,
            createSubscription,
            credential,
            environment,
            options,
        );
        return new SubscriptionClient(context);
    }

    public get tenants(): ISubscriptionClient['tenants'] {
        return { list: (options) => this.listTenants(options) };
    }

    public get subscriptions(): ISubscriptionClient['subscriptions'] {
        return {
            list: (options) => this.listSubscriptions(options),
            listLocations: (subscriptionId, options) => this.listLocations(subscriptionId, options),
        };
    }

    private listTenants(options?: TenantsListOptionalParams): AsyncIterable<Page<TenantIdDescription>> {
        return toPages(sdkListTenants(this.inner, options));
    }

    private listSubscriptions(options?: SubscriptionsListOptionalParams): AsyncIterable<Page<Subscription>> {
        return toPages(sdkListSubscriptions(this.inner, options));
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
