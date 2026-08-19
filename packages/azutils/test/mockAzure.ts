/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AccessToken, TokenCredential } from '@azure/core-auth';
import { EventEmitter, type ChildResult, type DataProvider, type Event, type Page } from '@microsoft/vscode-azure-utils';
import { mock, type Mock } from 'node:test';
import type { IAzureListingSource } from '../src/auth/AzureListingCache';
import type { AzureAccount, AzureSubscription, AzureTenant } from '../src/auth/AzureSubscription';
import { AzurePublicCloud, type EnvironmentLike } from '../src/auth/Environment';
import { isAccount, isTenant, type ConcreteAzureNode } from '../src/models/AzureNode';
import type { GenericResource } from '../src/models/GenericResource';
import type { ResourceGroup, VirtualGroup } from '../src/models/Grouping';
import type { VirtualResource } from '../src/models/VirtualResource';
import type { ISubscriptionClient, ISubscriptionClientProvider, Location, Subscription, TenantIdDescription } from '../src/rest/clients/SubscriptionClient';
import type { IWebAppClient } from '../src/rest/clients/WebAppClient';

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
 *
 * Product-specific resource interfaces can be supplied as {@linkcode TResource}
 * so their additional fields are preserved in the returned fixture.
 */
export function makeGenericResource(overrides?: Partial<GenericResource>): GenericResource;
export function makeGenericResource<TResource extends GenericResource>(
    overrides: Partial<GenericResource> & Omit<TResource, keyof GenericResource>,
): TResource;
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

/** Account provider fixture with a controllable account-removal event. */
export interface MockAccountDataProvider extends DataProvider<ConcreteAzureNode> {
    readonly onDidRemoveAccounts: Event<readonly string[]>;
    readonly removeAccountsEmitter: EventEmitter<readonly string[]>;
}

/**
 * Creates a mock root {@linkcode DataProvider} that yields canned accounts,
 * tenants, and subscriptions -- a stand-in for the real
 * `AzureAccountDataProvider` in tree tests and mock-data mode.
 *
 * {@linkcode DataProvider.getChildren getChildren} is wrapped with `mock.fn()`
 * so callers can assert call counts and arguments.
 */
export function createMockAccountDataProvider(options?: MockAccountDataProviderOptions): MockAccountDataProvider {
    const accounts = options?.accounts ?? [makeAccount()];
    const tenants = options?.tenants ?? [makeTenant()];
    const subscriptions = options?.subscriptions ?? [makeSubscription()];
    const removeAccountsEmitter = new EventEmitter<readonly string[]>();

    return {
        isRoot: true,
        onDidRemoveAccounts: removeAccountsEmitter.event,
        removeAccountsEmitter,
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

/**
 * Creates a mock {@linkcode IAzureListingSource} yielding the same canned
 * accounts, tenants, and subscriptions as
 * {@linkcode createMockAccountDataProvider} -- a stand-in for the raw listing
 * source that the discovery flows (Select Subscriptions, Sign In) read, which
 * see past the subscription filter the tree applies.
 */
export function createMockListingSource(options?: MockAccountDataProviderOptions): IAzureListingSource {
    const accounts = options?.accounts ?? [makeAccount()];
    const tenants = options?.tenants ?? [makeTenant()];
    const subscriptions = options?.subscriptions ?? [makeSubscription()];

    return {
        listAccounts: () => Promise.resolve(accounts),
        // eslint-disable-next-line @typescript-eslint/require-await
        listTenantsForAccount: () => (async function* () { yield { items: tenants, hasMore: false }; })(),
        // eslint-disable-next-line @typescript-eslint/require-await
        listSubscriptionsForTenant: () => (async function* () { yield { items: subscriptions, hasMore: false }; })(),
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

/** Options for {@linkcode createMockWebAppClient}. */
export interface MockWebAppClientOptions {
    /**
     * Initial application settings. Copied into the mutable store backing the
     * client, so mutating the returned settings never affects the caller's object.
     */
    readonly settings?: Record<string, string>;
    /** `defaultHostName` returned by `webApps.get`. */
    readonly defaultHostName?: string;
}

/**
 * An {@linkcode IWebAppClient} whose methods are `mock.fn()` instances, plus the
 * mutable application-settings store backing them.
 */
export type MockWebAppClient = IWebAppClient & {
    readonly settings: Record<string, string>;
    readonly webApps: { [K in keyof IWebAppClient['webApps']]: Mock<IWebAppClient['webApps'][K]> };
};

/**
 * Creates a mock {@linkcode IWebAppClient} whose methods are `mock.fn()` instances,
 * so tests can assert call counts and arguments via
 * `client.webApps.listApplicationSettings.mock`.
 *
 * Application settings are backed by a mutable store shared with the returned
 * {@linkcode MockWebAppClient.settings settings} object, so
 * `updateApplicationSettings` is observable by later reads. This lets tests
 * exercise read-modify-write flows without re-stubbing.
 */
export function createMockWebAppClient(options?: MockWebAppClientOptions): MockWebAppClient {
    const settings: Record<string, string> = { ...options?.settings };

    return {
        settings,
        webApps: {
            get: mock.fn(() => Promise.resolve({ location: 'eastus', defaultHostName: options?.defaultHostName })),
            listApplicationSettings: mock.fn(() => Promise.resolve({ properties: { ...settings } })),
            updateApplicationSettings: mock.fn((_resourceGroupName: string, _name: string, appSettings: { properties?: Record<string, string> }) => {
                // Replace rather than merge: the ARM operation is a full write of the setting collection.
                for (const key of Object.keys(settings)) {
                    Reflect.deleteProperty(settings, key);
                }
                Object.assign(settings, appSettings.properties);
                return Promise.resolve({ properties: { ...settings } });
            }),
        },
    };
}
