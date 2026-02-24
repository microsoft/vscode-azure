/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureAccount } from './AzureAccount'; // TODO: upstream the change and get rid of the unnecessary casts below
import { type AzureNode, isAccount, isGenericResource, isResourceGroup, isSubscription, isTenant, isVirtualGroup, isVirtualResource } from './AzureNode';
import type { ResourceGroup, VirtualGroup } from './Grouping';
import type { VirtualResource } from './VirtualResource';

const scheme = 'azr' as const;
const schemePrefix = `${scheme}://` as const;
const virtualGroupingPrefix = '~' as const;

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
// TODO: add tests for this class, especially the parsing logic
export class AzureNodeId {
    private constructor(private readonly data: AccountData | TenantData | SubscriptionData | GroupingData | ResourceData | VirtualData) { }

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
        if (armSegments.length >= 4 && armSegments[2].startsWith(virtualGroupingPrefix)) {
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

    /**
     * Creates an {@link AzureNodeId} from an {@link AzureNode} by extracting the necessary information
     * @param node An {@link AzureNode} to create a node ID for
     */
    public static from(node: AzureNode): AzureNodeId {
        switch (true) {
            case isAccount(node):
                return new AzureNodeId({
                    kind: 'account',
                    accountId: node.id,
                    portalHost: portalHost(node),
                });
            case isTenant(node):
                return new AzureNodeId({
                    kind: 'tenant',
                    accountId: node.account.id,
                    portalHost: portalHost(node.account as AzureAccount),
                    tenantId: node.tenantId,
                });
            case isSubscription(node):
                return new AzureNodeId({
                    kind: 'subscription',
                    accountId: node.account.id,
                    portalHost: portalHost(node.account as AzureAccount),
                    tenantId: node.tenantId,
                    armResourceId: `/subscriptions/${node.subscriptionId}`,
                });
            case isResourceGroup(node):
                return new AzureNodeId({
                    kind: 'grouping',
                    accountId: node.subscription.account.id,
                    portalHost: portalHost(node.subscription.account as AzureAccount),
                    tenantId: node.subscription.tenantId,
                    armResourceId: node.id,
                    grouping: {
                        groupingStrategy: 'resourceGroup',
                        groupingValue: node.name,
                    },
                });
            case isVirtualGroup(node):
                return new AzureNodeId({
                    kind: 'grouping',
                    accountId: node.subscription.account.id,
                    portalHost: portalHost(node.subscription.account as AzureAccount),
                    tenantId: node.subscription.tenantId,
                    armResourceId: `/subscriptions/${node.subscription.subscriptionId}/${virtualGroupingPrefix}${node.groupingStrategy}/${encodeURIComponent(node.groupingValue)}`,
                    grouping: node,
                });
            case isGenericResource(node):
                return new AzureNodeId({
                    kind: 'resource',
                    accountId: node.subscription.account.id,
                    portalHost: portalHost(node.subscription.account as AzureAccount),
                    tenantId: node.subscription.tenantId,
                    armResourceId: node.id,
                });
            case isVirtualResource(node):
                return new AzureNodeId({
                    kind: 'virtual',
                    accountId: node.azureResource.subscription.account.id,
                    portalHost: portalHost(node.azureResource.subscription.account as AzureAccount),
                    tenantId: node.azureResource.subscription.tenantId,
                    armResourceId: node.azureResource.id,
                    virtual: node,
                });
            default:
                throw new Error(`Unsupported node type: ${JSON.stringify(node)}`);
        }
    }

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

    //#region TODO: do we need these?
    /** Narrows this node ID to an {@link AzureAccount} node. */
    public isAccountNodeId(): boolean {
        return this.data.kind === 'account';
    }

    /** Narrows this node ID to an {@link AzureTenant} node. */
    public isTenantNodeId(): boolean {
        return this.data.kind === 'tenant';
    }

    /** Narrows this node ID to an {@link AzureSubscription} node. */
    public isSubscriptionNodeId(): boolean {
        return this.data.kind === 'subscription';
    }

    /** Narrows this node ID to a {@link VirtualGroup} node (non-RG grouping). */
    public isVirtualGroupNodeId(): boolean {
        return this.data.kind === 'grouping' && this.data.grouping.groupingStrategy !== 'resourceGroup';
    }

    /**
     * Narrows this node ID to a {@link ResourceGroup} node.
     * A resource group is a grouping node whose strategy is `'resourceGroup'`.
     */
    public isResourceGroupNodeId(): boolean {
        return this.data.kind === 'grouping' && this.data.grouping.groupingStrategy === 'resourceGroup';
    }

    /** Narrows this node ID to a {@link GenericResource} node. */
    public isGenericResourceNodeId(): boolean {
        return this.data.kind === 'resource';
    }

    /** Narrows this node ID to a {@link VirtualResource} node. */
    public isVirtualResourceNodeId(): boolean {
        return this.data.kind === 'virtual';
    }
    //#endregion
}

/**
 * Extracts the portal hostname (e.g. `"portal.azure.com"`) from an
 * {@link AzureSubscription.environment}'s `portalUrl`.
 */
function portalHost(account: AzureAccount): string {
    return new URL(account.environment.portalUrl).hostname;
}

//#region Internal interfaces for narrowing AzureNodeId.data based on kind
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
//#endregion
