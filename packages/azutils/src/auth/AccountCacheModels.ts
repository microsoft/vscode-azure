/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureAccount, AzureSubscription, AzureTenant } from './AzureSubscription';
import type { EnvironmentLike } from './Environment';

/**
 * On-disk format version for the persisted account cache. Bumped whenever the
 * serialized shape changes incompatibly; a loader that reads an unknown version
 * must treat the file as absent and rebuild from the network.
 */
export const AccountCacheFormatVersion = 1;

/**
 * A small, serializable fingerprint of an {@linkcode EnvironmentLike} used to
 * decide whether a persisted cache was captured against the same cloud the
 * extension is currently configured for.
 *
 * The live {@linkcode EnvironmentLike} is intentionally **not** persisted: its
 * endpoint-builder members are closures that `JSON.stringify` silently drops and
 * that cannot be reconstructed from the serialized object. Instead the cache
 * stores this fingerprint and re-hydrates the environment from configuration at
 * load time (see `getConfiguredAzureEnv`).
 */
export interface EnvironmentFingerprint {
    /** The cloud name, e.g. `'AzureCloud'`. */
    readonly name: string;
    /** The ARM endpoint, e.g. `https://management.azure.com` (no trailing slash). */
    readonly resourceManagerEndpointUrl: string;
    /** Whether the environment came from user-configured custom-cloud settings. */
    readonly isCustomCloud: boolean;
}

/**
 * An {@linkcode AzureAccount} with its non-serializable {@linkcode EnvironmentLike}
 * removed, suitable for JSON persistence.
 */
export type SerializedAccount = Omit<AzureAccount, 'environment'>;

/**
 * An {@linkcode AzureTenant} with its non-serializable {@linkcode EnvironmentLike}
 * removed, suitable for JSON persistence.
 */
export type SerializedTenant = Omit<AzureTenant, 'environment'>;

/**
 * An {@linkcode AzureSubscription} with its non-serializable
 * {@linkcode EnvironmentLike} removed, suitable for JSON persistence.
 */
export type SerializedSubscription = Omit<AzureSubscription, 'environment'>;

/**
 * A persisted tenant: a {@linkcode SerializedTenant} together with its
 * subscriptions, forming the middle level of the cached tree.
 */
export interface CachedTenant extends SerializedTenant {
    readonly subscriptions: readonly SerializedSubscription[];
}

/**
 * A persisted account: a {@linkcode SerializedAccount} together with its tenants,
 * forming the top level of the cached tree.
 */
export interface CachedAccount extends SerializedAccount {
    readonly tenants: readonly CachedTenant[];
}

/**
 * The complete persisted account → tenant → subscription snapshot written to
 * disk. The {@linkcode EnvironmentFingerprint} is stored once for the whole
 * snapshot because a single configured environment is attached to every record.
 */
export interface CachedAccountData {
    /** Format version; see {@linkcode AccountCacheFormatVersion}. */
    readonly version: number;
    /** Fingerprint of the environment the snapshot was captured against. */
    readonly environment: EnvironmentFingerprint;
    /** The cached accounts, each carrying their tenants and subscriptions. */
    readonly accounts: readonly CachedAccount[];
}

/** Build an {@linkcode EnvironmentFingerprint} from a live {@linkcode EnvironmentLike}. */
export function fingerprintEnvironment(environment: EnvironmentLike): EnvironmentFingerprint {
    return {
        name: environment.name,
        resourceManagerEndpointUrl: environment.resourceManagerEndpointUrl,
        isCustomCloud: environment.isCustomCloud,
    };
}

/**
 * Whether two {@linkcode EnvironmentFingerprint}s describe the same cloud. Used to
 * decide whether a persisted snapshot is still valid for the currently
 * configured environment.
 */
export function environmentFingerprintsMatch(a: EnvironmentFingerprint, b: EnvironmentFingerprint): boolean {
    return (
        a.name === b.name &&
        a.resourceManagerEndpointUrl === b.resourceManagerEndpointUrl &&
        a.isCustomCloud === b.isCustomCloud
    );
}

/** Return a shallow copy of `value` with its `environment` property removed. */
function omitEnvironment<T extends { environment: EnvironmentLike }>(value: T): Omit<T, 'environment'> {
    const clone: Partial<T> = { ...value };
    delete clone.environment;
    return clone as Omit<T, 'environment'>;
}

/** Strip the non-serializable environment from an {@linkcode AzureAccount}. */
export function toSerializedAccount(account: AzureAccount): SerializedAccount {
    return omitEnvironment(account);
}

/** Strip the non-serializable environment from an {@linkcode AzureTenant}. */
export function toSerializedTenant(tenant: AzureTenant): SerializedTenant {
    return omitEnvironment(tenant);
}

/** Strip the non-serializable environment from an {@linkcode AzureSubscription}. */
export function toSerializedSubscription(subscription: AzureSubscription): SerializedSubscription {
    return omitEnvironment(subscription);
}

/**
 * Re-hydrate an {@linkcode AzureAccount} from its serialized form by re-attaching
 * the live {@linkcode EnvironmentLike} (resolved from configuration at load time).
 */
export function fromSerializedAccount(account: SerializedAccount, environment: EnvironmentLike): AzureAccount {
    return { ...account, environment };
}

/**
 * Re-hydrate an {@linkcode AzureTenant} from its serialized form by re-attaching
 * the live {@linkcode EnvironmentLike} (resolved from configuration at load time).
 */
export function fromSerializedTenant(tenant: SerializedTenant, environment: EnvironmentLike): AzureTenant {
    return { ...tenant, environment };
}

/**
 * Re-hydrate an {@linkcode AzureSubscription} from its serialized form by
 * re-attaching the live {@linkcode EnvironmentLike} (resolved from configuration
 * at load time).
 */
export function fromSerializedSubscription(subscription: SerializedSubscription, environment: EnvironmentLike): AzureSubscription {
    return { ...subscription, environment };
}

/**
 * Compute the map key used to associate a tenant's subscriptions with their
 * owning account + tenant. Subscriptions are keyed by both ids because the same
 * tenant id can appear under different accounts.
 */
export function tenantCacheKey(accountId: string, tenantId: string): string {
    return `${accountId}/${tenantId}`;
}

/**
 * The in-memory, map-shaped view of a {@linkcode CachedAccountData} snapshot,
 * with every record re-hydrated to carry a live {@linkcode EnvironmentLike}.
 */
export interface HydratedAccountCache {
    /** The cached accounts. */
    readonly accounts: AzureAccount[];
    /** Tenants keyed by {@linkcode AzureAccount.id}. Only non-empty lists are present. */
    readonly tenantsByAccountId: Map<string, AzureTenant[]>;
    /** Subscriptions keyed by {@linkcode tenantCacheKey}. Only non-empty lists are present. */
    readonly subscriptionsByTenantKey: Map<string, AzureSubscription[]>;
}

/**
 * Expand a persisted {@linkcode CachedAccountData} tree into the map shape the
 * data provider serves from, re-attaching `environment` to every record.
 *
 * @param data - The persisted snapshot.
 * @param environment - The live environment to attach (typically the configured cloud).
 */
export function hydrateAccountCache(data: CachedAccountData, environment: EnvironmentLike): HydratedAccountCache {
    const accounts: AzureAccount[] = [];
    const tenantsByAccountId = new Map<string, AzureTenant[]>();
    const subscriptionsByTenantKey = new Map<string, AzureSubscription[]>();

    for (const cachedAccount of data.accounts) {
        const { tenants, ...serializedAccount } = cachedAccount;
        accounts.push(fromSerializedAccount(serializedAccount, environment));

        const tenantList: AzureTenant[] = [];
        for (const cachedTenant of tenants) {
            const { subscriptions, ...serializedTenant } = cachedTenant;
            tenantList.push(fromSerializedTenant(serializedTenant, environment));

            const subs = subscriptions.map(subscription => fromSerializedSubscription(subscription, environment));
            if (subs.length > 0) {
                subscriptionsByTenantKey.set(tenantCacheKey(cachedAccount.id, serializedTenant.tenantId), subs);
            }
        }
        if (tenantList.length > 0) {
            tenantsByAccountId.set(cachedAccount.id, tenantList);
        }
    }

    return { accounts, tenantsByAccountId, subscriptionsByTenantKey };
}

/**
 * Collapse the data provider's map-shaped, live (environment-bearing) state into
 * a serializable {@linkcode CachedAccountData} tree ready to persist. Inverse of
 * {@linkcode hydrateAccountCache}.
 *
 * @param environment - The environment the snapshot was captured against; only
 *   its {@linkcode EnvironmentFingerprint} is stored.
 * @param accounts - The accounts to persist, in order.
 * @param tenantsByAccountId - Tenants keyed by {@linkcode AzureAccount.id}.
 * @param subscriptionsByTenantKey - Subscriptions keyed by {@linkcode tenantCacheKey}.
 */
export function buildAccountCacheData(
    environment: EnvironmentLike,
    accounts: readonly AzureAccount[],
    tenantsByAccountId: ReadonlyMap<string, readonly AzureTenant[]>,
    subscriptionsByTenantKey: ReadonlyMap<string, readonly AzureSubscription[]>,
): CachedAccountData {
    return {
        version: AccountCacheFormatVersion,
        environment: fingerprintEnvironment(environment),
        accounts: accounts.map(account => ({
            ...toSerializedAccount(account),
            tenants: (tenantsByAccountId.get(account.id) ?? []).map(tenant => ({
                ...toSerializedTenant(tenant),
                subscriptions: (subscriptionsByTenantKey.get(tenantCacheKey(account.id, tenant.tenantId)) ?? []).map(toSerializedSubscription),
            } satisfies CachedTenant)),
        } satisfies CachedAccount)),
    };
}
