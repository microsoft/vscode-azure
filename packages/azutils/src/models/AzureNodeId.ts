/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Environment } from '@azure/ms-rest-azure-env';
import type { AzureSubscription, AzureTenant } from '@microsoft/vscode-azext-azureauth';
import type { AzureAccount } from './AzureAccount'; // TODO: upstream the change and get rid of the unnecessary casts below
import type { GenericResource } from './GenericResource';
import type { ResourceGroup, VirtualGroup } from './Grouping';
import type { VirtualResource } from './VirtualResource';

const scheme = 'azr' as const;
const schemePrefix = `${scheme}://` as const;
const virtualGroupingPrefix = '~' as const;

/**
 * The set of model types that an {@link AzureNodeId} can represent.
 */
export type NodeType = AzureAccount | AzureTenant | AzureSubscription | VirtualGroup | GenericResource | VirtualResource;

interface AccountFields {
    readonly accountId: string;
    readonly portalHost: string;
}
type AccountData = AccountFields & { readonly kind: 'account' };

interface TenantFields extends AccountFields {
    readonly tenantId: string;
}
type TenantData = TenantFields & { readonly kind: 'tenant' };

interface SubscriptionFields extends TenantFields {
    readonly armResourceId: string;
}
type SubscriptionData = SubscriptionFields & { readonly kind: 'subscription' };

type GroupingData = SubscriptionFields & { readonly kind: 'grouping'; readonly grouping: Pick<ResourceGroup | VirtualGroup, 'groupingStrategy' | 'groupingValue'> };
type ResourceData = SubscriptionFields & { readonly kind: 'resource'; };
type VirtualData = SubscriptionFields & { readonly kind: 'virtual'; readonly virtual: Pick<VirtualResource, 'virtualType' | 'virtualPath'> };

/**
 * A fully-opaque, URI-based identifier for nodes in the Azure resource tree.
 *
 * Examples:
 *  - Account: `azr://{accountId}@{portalHost}`
 *  - Tenant: `azr://{accountId}@{portalHost}/tenants/{tenantId}`
 *  - Subscription: `azr://{accountId}@{portalHost}/tenants/{tenantId}/{armResourceId}`
 *  - Resource Group: `azr://{accountId}@{portalHost}/tenants/{tenantId}/{armResourceId}`
 *  - Virtual Grouping: `azr://{accountId}@{portalHost}/tenants/{tenantId}/subscriptions/{subscriptionId}/~{groupingStrategy}/{groupingValue}`
 *  - Resource: `azr://{accountId}@{portalHost}/tenants/{tenantId}/{armResourceId}`
 *  - Virtual Resource: `azr://{accountId}@{portalHost}/tenants/{tenantId}/{armResourceId}#/{virtualType}/{virtualPath}`
 */
export class AzureNodeId {
    private constructor(private readonly data: AccountData | TenantData | SubscriptionData | GroupingData | ResourceData | VirtualData) { }

    // ── Static helpers ──────────────────────────────────────────────────────

    /**
     * Returns `true` if the given string looks like an `azr://` node ID.
     */
    public static test(value: string): boolean {
        return value.startsWith(schemePrefix);
    }

    /**
     * Parses an `azr://` URI string into an {@link AzureNodeId}.
     * Throws if the string is not a valid node ID.
     */
    public static parse(value: string): AzureNodeId {
        if (!AzureNodeId.test(value)) {
            throw new Error(`Not an ${schemePrefix} URI: ${value}`);
        }

        // Swap scheme to https:// so we can leverage the URL class for parsing
        const url = new URL('https://' + value.slice(schemePrefix.length));

        const accountId = url.username;
        const portalHost = url.hostname;
        const hash = url.hash ? url.hash.slice(1) : undefined; // strip leading #

        // Split pathname into non-empty segments (not decoded -- we reconstruct armResourceId verbatim)
        const segments = url.pathname.split('/').filter(Boolean);

        // Account-only: azr://{accountId}@{portalHost}
        if (segments.length === 0) {
            return new AzureNodeId({ kind: 'account', accountId, portalHost });
        }

        // Otherwise, must have /tenants/{tenantId}
        if (segments.length < 2 || segments[0].toLowerCase() !== 'tenants') {
            throw new Error(`Invalid ${schemePrefix} URI: expected /tenants/{tenantId}`);
        }
        const tenantId = segments[1];

        // Tenant-only: azr://{accountId}@{portalHost}/tenants/{tenantId}
        if (segments.length === 2) {
            return new AzureNodeId({ kind: 'tenant', accountId, portalHost, tenantId });
        }

        // Everything past tenants/{tenantId} is the armResourceId
        const armResourceId = '/' + segments.slice(2).join('/');

        // The ARM-level segments (subscriptions/{id}/...)
        const armSegments = segments.slice(2);

        // Virtual resource: has a URI fragment (#/{virtualType}/{encodedPath})
        if (hash !== undefined) {
            const hashParts = hash.split('/').filter(Boolean);
            if (hashParts.length < 2) {
                throw new Error(`Invalid ${schemePrefix} URI fragment: expected #/{virtualType}/{virtualPath}`);
            }

            return new AzureNodeId({
                kind: 'virtual',
                accountId,
                portalHost,
                tenantId,
                armResourceId,
                virtual: {
                    virtualType: hashParts[0],
                    virtualPath: decodeURIComponent(hashParts.slice(1).join('/')),
                },
            });
        }

        // Virtual grouping: /subscriptions/{id}/~{strategy}/{value}
        if (armSegments.length >= 3 && armSegments[2].startsWith(virtualGroupingPrefix)) {
            return new AzureNodeId({
                kind: 'grouping',
                accountId,
                portalHost,
                tenantId,
                armResourceId,
                grouping: {
                    groupingStrategy: armSegments[2].slice(1) as VirtualGroup['groupingStrategy'],
                    groupingValue: decodeURIComponent(armSegments[3]),
                },
            });
        }

        // Subscription only: /subscriptions/{id}
        if (armSegments.length === 2) {
            return new AzureNodeId({ kind: 'subscription', accountId, portalHost, tenantId, armResourceId });
        }

        // Resource group grouping: /subscriptions/{id}/resourceGroups/{name} (exactly, no providers after)
        if (armSegments.length === 4 && armSegments[2].toLowerCase() === 'resourcegroups') {
            return new AzureNodeId({
                kind: 'grouping',
                accountId,
                portalHost,
                tenantId,
                armResourceId,
                grouping: {
                    groupingStrategy: 'resourceGroup' as const,
                    groupingValue: armSegments[3],
                },
            });
        }

        // Resource: anything else (has providers/nested segments beyond resourceGroups/{name})
        return new AzureNodeId({ kind: 'resource', accountId, portalHost, tenantId, armResourceId });
    }

    // ── Static factory methods ──────────────────────────────────────────────

    /**
     * Creates a node ID for an {@link AzureAccount}.
     */
    public static fromAccount(account: AzureAccount): AzureNodeId {
        return new AzureNodeId({
            kind: 'account',
            accountId: account.id,
            portalHost: portalHost(account.environment),
        });
    }

    /**
     * Creates a node ID for an {@link AzureTenant}.
     */
    public static fromTenant(tenant: AzureTenant): AzureNodeId {
        const acct = tenant.account as AzureAccount;
        return new AzureNodeId({
            kind: 'tenant',
            accountId: acct.id,
            portalHost: portalHost(acct.environment),
            tenantId: tenant.tenantId,
        });
    }

    /**
     * Creates a node ID for an {@link AzureSubscription}.
     */
    public static fromSubscription(sub: AzureSubscription): AzureNodeId {
        const acct = sub.account as AzureAccount;
        return new AzureNodeId({
            kind: 'subscription',
            accountId: acct.id,
            portalHost: portalHost(acct.environment),
            tenantId: sub.tenantId,
            armResourceId: `/subscriptions/${sub.subscriptionId}`,
        });
    }

    /**
     * Creates a node ID for a {@link ResourceGroup} or {@link VirtualGroup}.
     */
    public static fromGrouping(grouping: ResourceGroup | VirtualGroup): AzureNodeId {
        const sub = grouping.subscription;
        const acct = sub.account as AzureAccount;

        let armResourceId: string;
        if (grouping.groupingStrategy === 'resourceGroup') {
            // Resource groups have a real ARM ID we can link to
            armResourceId = grouping.id;
        } else {
            // Virtual groups don't have a real ARM ID, so we put together a fake one that looks similar
            armResourceId = `/subscriptions/${sub.subscriptionId}/${virtualGroupingPrefix}${grouping.groupingStrategy}/${encodeURIComponent(grouping.groupingValue)}`;
        }

        return new AzureNodeId({
            kind: 'grouping',
            accountId: acct.id,
            portalHost: portalHost(acct.environment),
            tenantId: sub.tenantId,
            armResourceId,
            grouping,
        });
    }

    /**
     * Creates a node ID for a {@link GenericResource}. This handles both
     * resource groups and nested ARM resources -- the ARM `id` is parsed to
     * extract the resource group and any provider path.
     */
    public static fromResource(resource: GenericResource): AzureNodeId {
        const sub = resource.subscription;
        const acct = sub.account as AzureAccount;
        return new AzureNodeId({
            kind: 'resource',
            accountId: acct.id,
            portalHost: portalHost(acct.environment),
            tenantId: sub.tenantId,
            armResourceId: resource.id,
        });
    }

    /**
     * Creates a node ID for a {@link VirtualResource} (a non-ARM resource
     * nested under a real Azure resource, such as a file in a Function App).
     */
    public static fromVirtual(virtual: VirtualResource): AzureNodeId {
        const sub = virtual.azureResource.subscription;
        const acct = sub.account as AzureAccount;
        return new AzureNodeId({
            kind: 'virtual',
            accountId: acct.id,
            portalHost: portalHost(acct.environment),
            tenantId: sub.tenantId,
            armResourceId: virtual.azureResource.id,
            virtual,
        });
    }

    // ── Instance output methods ─────────────────────────────────────────────

    /**
     * Serializes this node ID to its canonical `azr://` URI string.
     * Roundtrips with {@link AzureNodeId.parse}: `parse(id.toString())` will
     * produce an equivalent node ID.
     */
    public toString(): string {
        const d = this.data;
        const parts = [schemePrefix, d.accountId, '@', d.portalHost];

        if (d.kind !== 'account') {
            parts.push('/tenants/', d.tenantId);
        }

        if (d.kind !== 'account' && d.kind !== 'tenant') {
            parts.push(d.armResourceId);
        }

        if (d.kind === 'virtual') {
            parts.push('#/', d.virtual.virtualType, '/', encodeURIComponent(d.virtual.virtualPath));
        }

        return parts.join('');
    }

    /**
     * Builds a portal URL for this node. Only applicable to subscriptions,
     * resource groups, and resources. Throws for accounts, tenants, and non-RG groupings,
     *
     * @returns A URL like `https://portal.azure.com/#@{tenantId}/resource/subscriptions/{subId}/...`
     */
    public toPortalUrl(): string {
        const d = this.data;

        switch (d.kind) {
            case 'account':
            case 'tenant':
                throw new Error(`Cannot create a portal URL for a node of kind "${d.kind}"`);

            case 'grouping':
                if (d.grouping.groupingStrategy !== 'resourceGroup') {
                    throw new Error(`Cannot create a portal URL for a virtual grouping`);
                }

            // eslint-disable-next-line no-fallthrough -- Fallthrough is **intentional**, subs/resource groups/resources/virtuals all use ARM resource ID-based URLs
            case 'subscription':
            case 'resource':
            case 'virtual':
                return `https://${d.portalHost}/#@${d.tenantId}/resource${d.armResourceId}`;
        }
    }

    // ── Type guards ─────────────────────────────────────────────────────────

    /** Narrows this node ID to an {@link AzureAccount} node. */
    public isAccount(): boolean {
        return this.data.kind === 'account';
    }

    /** Narrows this node ID to an {@link AzureTenant} node. */
    public isTenant(): boolean {
        return this.data.kind === 'tenant';
    }

    /** Narrows this node ID to an {@link AzureSubscription} node. */
    public isSubscription(): boolean {
        return this.data.kind === 'subscription';
    }

    /** Narrows this node ID to a {@link VirtualGroup} node. */
    public isGrouping(): boolean {
        return this.data.kind === 'grouping';
    }

    /**
     * Narrows this node ID to a {@link ResourceGroup} node.
     * A resource group is a grouping node whose strategy is `'resourceGroup'`.
     */
    public isResourceGroup(): boolean {
        return this.data.kind === 'grouping' && this.data.grouping.groupingStrategy === 'resourceGroup';
    }

    /** Narrows this node ID to a {@link GenericResource} node. */
    public isResource(): boolean {
        return this.data.kind === 'resource';
    }

    /** Narrows this node ID to a {@link VirtualResource} node. */
    public isVirtual(): boolean {
        return this.data.kind === 'virtual';
    }
}

/**
 * Extracts the portal hostname (e.g. `"portal.azure.com"`) from an
 * {@link AzureSubscription.environment}'s `portalUrl`.
 */
function portalHost(env: Pick<Environment, 'portalUrl'>): string {
    return new URL(env.portalUrl).hostname;
}
