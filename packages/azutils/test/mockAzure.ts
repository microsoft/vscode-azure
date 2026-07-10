/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AccessToken, TokenCredential } from '@azure/core-auth';
import type { ChildResult, DataProvider, Page } from '@microsoft/vscode-azure-utils';
import { mock } from 'node:test';
import type { AzureAccount, AzureSubscription, AzureTenant } from '../src/auth/AzureSubscription';
import { AzurePublicCloud, type EnvironmentLike } from '../src/auth/Environment';
import { isAccount, isTenant, type ConcreteAzureNode } from '../src/models/AzureNode';
import type { GenericResource } from '../src/models/GenericResource';
import type { ResourceGroup, VirtualGroup } from '../src/models/Grouping';
import type { VirtualResource } from '../src/models/VirtualResource';
import type { ISubscriptionClient, ISubscriptionClientProvider, Location, Subscription, TenantIdDescription } from '../src/rest/clients/SubscriptionClient';

const defaultEnvironment: EnvironmentLike = AzurePublicCloud;

/**
 * Builds a mock {@linkcode AzureAccount} with sensible defaults.
 * Pass `overrides` to customise individual fields.
 */
export function makeAccount(overrides?: Partial<AzureAccount>): AzureAccount {
    return {
        id: 'test-account',
        label: 'Test Account',
        environment: defaultEnvironment,
        ...overrides,
    };
}

/**
 * Builds a mock {@linkcode AzureTenant} whose default account id comes
 * from a fresh {@linkcode makeAccount} instance.
 */
export function makeTenant(overrides?: Partial<AzureTenant>): AzureTenant {
    const account = makeAccount();
    return {
        tenantId: 'test-tenant',
        displayName: 'Test Tenant',
        environment: account.environment,
        accountId: account.id,
        ...overrides,
    };
}

/**
 * Builds a mock {@linkcode AzureSubscription}. Default account id,
 * tenant id, and environment come from {@linkcode makeTenant}.
 */
export function makeSubscription(overrides?: Partial<AzureSubscription>): AzureSubscription {
    const tenant = makeTenant();
    return {
        subscriptionId: 'test-sub',
        displayName: 'Test Subscription',
        tenantId: tenant.tenantId,
        environment: tenant.environment,
        accountId: tenant.accountId,
        ...overrides,
    };
}

/**
 * Builds a mock {@linkcode TokenCredential} whose `getToken` returns a fixed
 * token valid for one hour. The method is wrapped with `mock.fn()` from
 * `node:test` so callers can assert call counts and inspect `GetTokenOptions`
 * (e.g. `claims` for CAE/MFA challenge handling).
 */
export function makeCredential(token = 'mock-token'): TokenCredential {
    return {
        getToken: mock.fn((): Promise<AccessToken> => Promise.resolve({ token, expiresOnTimestamp: Date.now() + 3600000 })),
    };
}

/**
 * Builds a mock {@linkcode ResourceGroup} rooted in the default
 * {@linkcode makeSubscription}.
 */
export function makeResourceGroup(overrides?: Partial<ResourceGroup>): ResourceGroup {
    return {
        id: '/subscriptions/test-sub/resourceGroups/rg1',
        name: 'rg1',
        type: 'Microsoft.Resources/resourceGroups',
        location: 'eastus',
        logicalType: 'Microsoft.Resources/resourceGroups',
        subscription: makeSubscription(),
        groupingStrategy: 'resourceGroup',
        groupingValue: 'rg1',
        ...overrides,
    };
}

/**
 * Builds a mock {@linkcode GenericResource} representing a web site in
 * the default resource group.
 */
export function makeGenericResource(overrides?: Partial<GenericResource>): GenericResource {
    return {
        id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/site1',
        name: 'site1',
        type: 'Microsoft.Web/sites',
        location: 'eastus',
        logicalType: 'Microsoft.Web/sites',
        subscription: makeSubscription(),
        ...overrides,
    };
}

/**
 * Builds a mock {@linkcode VirtualGroup} (a non-Azure grouping node in
 * the tree) for the default subscription.
 */
export function makeVirtualGroup(overrides?: Partial<VirtualGroup>): VirtualGroup {
    return {
        groupingStrategy: 'resourceType',
        groupingValue: 'Microsoft.Web/sites',
        subscription: makeSubscription(),
        ...overrides,
    };
}

/**
 * Builds a mock {@linkcode VirtualResource} (a synthetic child resource
 * such as a container-registry repository) hanging off the default
 * {@linkcode makeGenericResource}.
 */
export function makeVirtualResource(overrides?: Partial<VirtualResource>): VirtualResource {
    return {
        virtualType: 'repository',
        virtualPath: 'myrepo',
        azureResource: makeGenericResource(),
        ...overrides,
    };
}

/** Options for overriding mock account/tenant/subscription data defaults. */
export interface MockAccountDataProviderOptions {
    readonly accounts?: AzureAccount[];
    readonly tenants?: AzureTenant[];
    readonly subscriptions?: AzureSubscription[];
}

/**
 * Creates a mock root {@linkcode DataProvider} that yields canned accounts,
 * tenants, and subscriptions -- a stand-in for the real
 * `AzureAccountDataProvider` in tree tests and mock-data mode.
 *
 * {@linkcode DataProvider.getChildren getChildren} is wrapped with `mock.fn()`
 * so callers can assert call counts and arguments.
 */
export function createMockAccountDataProvider(options?: MockAccountDataProviderOptions): DataProvider<ConcreteAzureNode> {
    const accounts = options?.accounts ?? [makeAccount()];
    const tenants = options?.tenants ?? [makeTenant()];
    const subscriptions = options?.subscriptions ?? [makeSubscription()];

    return {
        isRoot: true,
        getTtl: () => Infinity,
        canHandle: (resource: unknown): resource is ConcreteAzureNode => {
            if (!resource || typeof resource !== 'object') {
                return false;
            }
            const node = resource as ConcreteAzureNode;
            return isAccount(node) || isTenant(node);
        },
        getChildren: mock.fn((resource?: ConcreteAzureNode): Promise<ChildResult<ConcreteAzureNode>> => {
            if (!resource) {
                return Promise.resolve(accounts as ConcreteAzureNode[]);
            } else if (isAccount(resource)) {
                return Promise.resolve(tenants as ConcreteAzureNode[]);
            } else if (isTenant(resource)) {
                return Promise.resolve(subscriptions as ConcreteAzureNode[]);
            } else {
                throw new Error(`Unsupported resource type: ${JSON.stringify(resource)}`);
            }
        }),
    };
}

/** Options for {@linkcode createMockSubscriptionClient}. */
export interface MockSubscriptionClientOptions {
    /** Pages yielded by `tenants.list`. Defaults to a single empty page. */
    readonly tenantPages?: Array<Page<TenantIdDescription>>;
    /** Pages yielded by `subscriptions.list`. Defaults to a single empty page. */
    readonly subscriptionPages?: Array<Page<Subscription>>;
    /** Locations resolved by `subscriptions.listLocations`. Defaults to `[]`. */
    readonly locations?: Location[];
}

/**
 * Creates a mock {@linkcode ISubscriptionClient} whose `tenants.list` and
 * `subscriptions.list` lazily yield the supplied pages (a single empty page by
 * default) and whose `subscriptions.listLocations` resolves to the supplied
 * `locations`.
 *
 * `listLocations` is wrapped with `mock.fn()` so callers can assert call counts
 * and arguments.
 */
export function createMockSubscriptionClient(options?: MockSubscriptionClientOptions): ISubscriptionClient {
    const tenantPages = options?.tenantPages ?? [{ items: [], hasMore: false }];
    const subscriptionPages = options?.subscriptionPages ?? [{ items: [], hasMore: false }];
    const locations = options?.locations ?? [];
    return {
        tenants: {
            // eslint-disable-next-line @typescript-eslint/require-await
            list: () => (async function* () { yield* tenantPages; })(),
        },
        subscriptions: {
            // eslint-disable-next-line @typescript-eslint/require-await
            list: () => (async function* () { yield* subscriptionPages; })(),
            listLocations: mock.fn(() => Promise.resolve(locations)),
        },
    };
}

/**
 * Creates a mock {@linkcode ISubscriptionClientProvider} backed by a
 * {@linkcode createMockSubscriptionClient} whose `subscriptions.listLocations`
 * resolves to the supplied `locations`.
 */
export function createMockSubscriptionClientProvider(locations: Location[] = []): ISubscriptionClientProvider {
    const client = createMockSubscriptionClient({ locations });
    return () => client;
}
