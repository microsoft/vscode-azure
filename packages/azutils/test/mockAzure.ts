/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AccessToken, TokenCredential } from '@azure/core-auth';
import { CaselessSet, EventEmitter, type ChildResult, type DataProvider, type Event, type Page } from '@microsoft/vscode-azure-utils';
import { mock, type Mock } from 'node:test';
import type * as vscode from 'vscode';
import { isAzureSubscription, type AzureAccount, type AzureSubscription, type AzureTenant } from '../src/auth/AzureSubscription';
import type { ICredentialFactory } from '../src/auth/CredentialFactory';
import type { IAzureListingFetcher } from '../src/auth/listing/AzureListingFetcher';
import type { VsCodeExtensionCredential } from '../src/auth/VsCodeExtensionCredential';
import { AzurePublicCloud, type EnvironmentLike } from '../src/auth/Environment';
import { NotSignedInError } from '../src/auth/NotSignedInError';
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

/** Options for {@linkcode createMockCredentialFactory}. */
export interface MockCredentialFactoryOptions {
    /**
     * The account a session resolves to when the caller did not scope its
     * request to one.
     *
     * This is what a sign-in to a manually-entered tenant reports back: the
     * caller has a tenant id but no account context, and learns which account
     * the tenant turned out to belong to only from the resulting session.
     * Defaults to {@linkcode makeAccount}.
     */
    readonly account?: AzureAccount;

    /**
     * Whether a request asking for a silent acquisition fails, modelling a
     * fixture with no cached session to satisfy it. Defaults to `false`.
     *
     * Background passes (tenant-name enrichment, subscription resolution) force
     * silent acquisition precisely so they cannot prompt, so this is what
     * decides whether such a pass succeeds or leaves its subject untouched.
     */
    readonly denySilentAcquisition?: boolean;

    /** The access token every produced credential returns. */
    readonly token?: string;
}

/**
 * Creates a mock {@linkcode ICredentialFactory} that authenticates without
 * touching VS Code's authentication provider, so a sign-in flow can be driven
 * end to end without an interactive prompt.
 *
 * The produced credential carries the `authenticate()` method that
 * {@linkcode VsCodeExtensionCredential} exposes and sign-in flows depend on,
 * resolving a session for the account the request was scoped to, or for
 * {@linkcode MockCredentialFactoryOptions.account} when it was not scoped to
 * one.
 *
 * The factory is wrapped with `mock.fn()` so callers can assert what each
 * credential was scoped to -- the tenant id and session options are what decide
 * whether a sign-in prompts.
 */
export function createMockCredentialFactory(options?: MockCredentialFactoryOptions): Mock<ICredentialFactory> {
    const fallbackAccount = options?.account ?? makeAccount();
    const token = options?.token ?? 'mock-token';

    return mock.fn<ICredentialFactory>((input) => {
        const scope = isAzureSubscription(input)
            ? { tenantId: input.tenantId, accountId: input.accountId, silent: false }
            : { tenantId: input?.tenantId, accountId: input?.sessionOptions?.account?.id, silent: input?.sessionOptions?.silent ?? false };

        const authenticate = (): Promise<vscode.AuthenticationSession> => {
            if (scope.silent && options?.denySilentAcquisition) {
                return Promise.reject(new Error(`Mock: no cached session for tenant ${scope.tenantId ?? '<default>'}`));
            }
            return Promise.resolve({
                id: `mock-session-${scope.tenantId ?? 'default'}`,
                accessToken: token,
                account: scope.accountId
                    ? { id: scope.accountId, label: scope.accountId }
                    : { id: fallbackAccount.id, label: fallbackAccount.label },
                scopes: [],
            });
        };

        return {
            getToken: mock.fn(async (): Promise<AccessToken> => {
                await authenticate();
                return { token, expiresOnTimestamp: Date.now() + 3600000 };
            }),
            authenticate: mock.fn(authenticate),
        } satisfies Pick<VsCodeExtensionCredential, 'getToken' | 'authenticate'>;
    });
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

/** Options for {@linkcode createMockAzureListingFetcher}. */
export interface MockAzureListingFetcherOptions {
    /** Accounts returned by `fetchAccounts`. Defaults to a single {@linkcode makeAccount}. */
    readonly accounts?: AzureAccount[];
    /** Every tenant, matched to its account by `accountId`. Defaults to a single {@linkcode makeTenant}. */
    readonly tenants?: AzureTenant[];
    /** Every subscription, matched to its tenant by `accountId` + `tenantId`. Defaults to a single {@linkcode makeSubscription}. */
    readonly subscriptions?: AzureSubscription[];
    /** Items per page for the tenant and subscription listings. Defaults to one page per listing. */
    readonly pageSize?: number;
    /** Tenant ids whose subscription listing rejects, simulating a tenant that cannot mint a token. */
    readonly unreachableTenantIds?: string[];
    /**
     * Tenant ids whose subscription listing rejects with a
     * {@linkcode NotSignedInError}, simulating a tenant the user has access to
     * but has never signed in to -- the routine case, distinct from a fault.
     */
    readonly signedOutTenantIds?: string[];
    /**
     * Account ids whose tenant listing is blocked, simulating conditional access
     * denying enumeration outright.
     *
     * Such an account lists no tenants at all -- degrading rather than throwing,
     * the way the real fetcher does, since a tenant-scoped sign-in still reaches
     * a tenant the user can name. Those named tenants are merged in above the
     * fetcher, by {@linkcode AzureListingCache}.
     */
    readonly unlistableAccountIds?: string[];
    /**
     * Called each time a tenant or subscription page is actually produced,
     * naming the listing and the zero-based page index.
     *
     * Listings are lazy, so a page that is never pulled is never reported --
     * which is what lets a test assert that a reader stopped after the first
     * page, or that a second read replayed from cache instead of re-pulling.
     */
    readonly onPagePulled?: (listing: 'tenants' | 'subscriptions', pageIndex: number) => void;
}

/**
 * An {@linkcode IAzureListingFetcher} fixture whose three fetch methods are
 * `mock.fn()` instances, so a test can assert exactly which listings were
 * issued -- the property most of the listing-layer requirements are stated in
 * terms of.
 */
export interface MockAzureListingFetcher extends IAzureListingFetcher {
    readonly fetchAccounts: Mock<IAzureListingFetcher['fetchAccounts']>;
    readonly fetchTenants: Mock<IAzureListingFetcher['fetchTenants']>;
    readonly fetchSubscriptions: Mock<IAzureListingFetcher['fetchSubscriptions']>;
}

/**
 * Creates a mock {@linkcode IAzureListingFetcher} serving canned accounts,
 * tenants, and subscriptions.
 *
 * Membership comes from the fixtures themselves (a tenant belongs to the
 * account named by its `accountId`; a subscription to the tenant named by its
 * `accountId` + `tenantId`), so a subscription reachable through two tenants is
 * expressed the way it is in Azure -- two entries with the same
 * `subscriptionId` and different `tenantId`s.
 *
 * Listings are lazy: a page is produced only when the reader asks for it, so a
 * test can assert that a caller stopped after the first page.
 *
 * The supplied arrays are read on every call rather than copied up front, so a
 * caller may append to them between listings to model data that appears while
 * the fixture is live (e.g. a subscription that becomes visible only once its
 * tenant has been signed in to).
 */
export function createMockAzureListingFetcher(options?: MockAzureListingFetcherOptions): MockAzureListingFetcher {
    const accounts = options?.accounts ?? [makeAccount()];
    const tenants = options?.tenants ?? [makeTenant()];
    const subscriptions = options?.subscriptions ?? [makeSubscription()];
    const unreachable = new CaselessSet(options?.unreachableTenantIds ?? []);
    const signedOut = new CaselessSet(options?.signedOutTenantIds ?? []);
    const unlistable = new CaselessSet(options?.unlistableAccountIds ?? []);

    async function* paged<T>(listing: 'tenants' | 'subscriptions', items: T[]): AsyncIterable<Page<T>> {
        const size = options?.pageSize ?? Math.max(items.length, 1);
        for (let start = 0, index = 0; start < items.length || start === 0; start += size, index++) {
            const slice = items.slice(start, start + size);
            options?.onPagePulled?.(listing, index);
            yield await Promise.resolve({ items: slice, hasMore: start + size < items.length });
        }
    }

    return {
        fetchAccounts: mock.fn(() => Promise.resolve([...accounts])),
        fetchTenants: mock.fn((account: AzureAccount) => paged('tenants', unlistable.has(account.id)
            ? []
            : tenants.filter(tenant => tenant.accountId.toLowerCase() === account.id.toLowerCase()))),
        fetchSubscriptions: mock.fn((tenant: AzureTenant) => {
            const error = signedOut.has(tenant.tenantId)
                ? new NotSignedInError(`Mock: no session for tenant ${tenant.tenantId}`)
                : unreachable.has(tenant.tenantId)
                    ? new Error(`Mock: cannot list subscriptions for tenant ${tenant.tenantId}`)
                    : undefined;
            if (error) {
                const rejecting: AsyncIterable<Page<AzureSubscription>> = {
                    [Symbol.asyncIterator]: () => ({
                        next: () => Promise.reject(error),
                    }),
                };
                return rejecting;
            }
            return paged('subscriptions', subscriptions.filter(sub =>
                sub.accountId.toLowerCase() === tenant.accountId.toLowerCase()
                && sub.tenantId.toLowerCase() === tenant.tenantId.toLowerCase()));
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
