/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { EnvironmentLike } from '../auth/Environment';
import { getResourceGroupArmId, getSubscriptionArmId, parseAzureResourceId } from '../utils/azureResourceId';
import { type AzureNode, isAccount, isGenericResource, isResourceGroup, isSubscription, isTenant, isVirtualGroup, isVirtualResource } from './AzureNode';
import type { ResourceGroup, VirtualGroup } from './Grouping';
import type { VirtualResource } from './VirtualResource';

const scheme = 'azr' as const;
const schemePrefix = `${scheme}://` as const;
const virtualGroupingPrefix = '~' as const;
const portalQueryParam = 'portal' as const;

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
 *  - Virtual Resource with a distinct portal page: as above, plus a
 *    `?{portalQueryParam}={portalUrl}` query string before the fragment.
 */
export class AzureNodeId {
    private static readonly parseCache = new Map<string, AzureNodeId>();

    private constructor(private readonly data: AccountData | TenantData | SubscriptionData | GroupingData | ResourceData | VirtualData) { }

    /**
     * Returns `true` if the given string looks like an `azr://` node ID.
     */
    public static test(value: string): boolean {
        return value.startsWith(schemePrefix);
    }

    /**
     * Parses an `azr://` URI string into an {@linkcode AzureNodeId}.
     * Returns a cached instance if the same string was parsed before.
     * Throws if the string is not a valid node ID.
     */
    public static parse(value: string): AzureNodeId {
        const cached = AzureNodeId.parseCache.get(value);
        if (cached) {
            return cached;
        }

        const result = AzureNodeId.parseImpl(value);
        AzureNodeId.parseCache.set(value, result);
        return result;
    }

    /**
     * Clears all cached parse results.
     */
    public static clearParseCache(): void {
        AzureNodeId.parseCache.clear();
    }

    private static parseImpl(value: string): AzureNodeId {
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
                    portalUrl: validatePortalUrl(url.searchParams.get(portalQueryParam) ?? undefined, portalHost),
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
        const parsed = parseAzureResourceId(armResourceId);
        if (parsed.resourceGroup && !parsed.provider) {
            return new AzureNodeId({
                kind: 'grouping',
                accountId,
                portalHost,
                tenantId,
                armResourceId,
                grouping: {
                    groupingStrategy: 'resourceGroup' satisfies ResourceGroup['groupingStrategy'],
                    groupingValue: parsed.resourceGroup,
                },
            });
        }

        // Resource: anything else (has providers/nested segments beyond resourceGroups/{name})
        return new AzureNodeId({ kind: 'resource', accountId, portalHost, tenantId, armResourceId });
    }

    /**
     * Creates an {@linkcode AzureNodeId} from an {@linkcode AzureNode} by extracting the necessary information
     * @param node An {@linkcode AzureNode} to create a node ID for
     */
    public static from(node: AzureNode): AzureNodeId {
        let result: AzureNodeId;
        switch (true) {
            case isAccount(node):
                result = new AzureNodeId({
                    kind: 'account',
                    accountId: node.id,
                    portalHost: portalHost(node),
                });
                break;
            case isTenant(node):
                result = new AzureNodeId({
                    kind: 'tenant',
                    accountId: node.accountId,
                    portalHost: portalHost(node),
                    tenantId: node.tenantId,
                });
                break;
            case isSubscription(node):
                result = new AzureNodeId({
                    kind: 'subscription',
                    accountId: node.accountId,
                    portalHost: portalHost(node),
                    tenantId: node.tenantId,
                    armResourceId: `/subscriptions/${node.subscriptionId}`,
                });
                break;
            case isResourceGroup(node):
                result = new AzureNodeId({
                    kind: 'grouping',
                    accountId: node.subscription.accountId,
                    portalHost: portalHost(node.subscription),
                    tenantId: node.subscription.tenantId,
                    armResourceId: node.id,
                    grouping: {
                        groupingStrategy: 'resourceGroup' satisfies ResourceGroup['groupingStrategy'],
                        groupingValue: node.name,
                    },
                });
                break;
            case isVirtualGroup(node):
                result = new AzureNodeId({
                    kind: 'grouping',
                    accountId: node.subscription.accountId,
                    portalHost: portalHost(node.subscription),
                    tenantId: node.subscription.tenantId,
                    armResourceId: `/subscriptions/${node.subscription.subscriptionId}/${virtualGroupingPrefix}${node.groupingStrategy}/${encodeURIComponent(node.groupingValue)}`,
                    grouping: node,
                });
                break;
            case isGenericResource(node):
                result = new AzureNodeId({
                    kind: 'resource',
                    accountId: node.subscription.accountId,
                    portalHost: portalHost(node.subscription),
                    tenantId: node.subscription.tenantId,
                    armResourceId: node.id,
                });
                break;
            case isVirtualResource(node): {
                const host = portalHost(node.azureResource.subscription);
                result = new AzureNodeId({
                    kind: 'virtual',
                    accountId: node.azureResource.subscription.accountId,
                    portalHost: host,
                    tenantId: node.azureResource.subscription.tenantId,
                    armResourceId: node.azureResource.id,
                    virtual: {
                        virtualType: node.virtualType,
                        virtualPath: node.virtualPath,
                        portalUrl: validatePortalUrl(node.portalUrl, host),
                    },
                });
                break;
            }
            default:
                throw new Error(`Unsupported node type: ${JSON.stringify(node)}`);
        }

        // Populate the parse cache so subsequent parse() calls for the same key are free
        AzureNodeId.parseCache.set(result.toString(), result);
        return result;
    }

    /**
     * Serializes this node ID to its canonical `azr://` URI string.
     * Roundtrips with {@linkcode AzureNodeId.parse}: `parse(id.toString())` will
     * produce an equivalent node ID.
     */
    public toString(): string {
        const d = this.data;
        // The account id and tenant id are case-insensitive identities (the
        // account id is an AAD/object id, the tenant id is a GUID), so they are
        // lowercased here to give every node a single canonical key regardless
        // of the casing the provider happened to emit. The id is treated as
        // opaque elsewhere, so normalizing only at serialization time keeps the
        // verbatim values on the in-memory data objects (where the account id
        // doubles as the VS Code `getSession` identity).
        const parts = [schemePrefix, d.accountId.toLowerCase(), '@', d.portalHost];

        if (d.kind !== 'account') {
            parts.push('/tenants/', d.tenantId.toLowerCase());
        }

        if (d.kind !== 'account' && d.kind !== 'tenant') {
            parts.push(d.armResourceId);
        }

        if (d.kind === 'virtual') {
            if (d.virtual.portalUrl) {
                // A query string keeps the portal target out of both the ARM path
                // and the fragment, so existing ids parse unchanged and the
                // armResourceId is still reconstructed verbatim from the pathname.
                // Per RFC 3986 the query must precede the fragment; anything after
                // the "#" would be swallowed into the fragment instead.
                parts.push('?', portalQueryParam, '=', encodeURIComponent(d.virtual.portalUrl));
            }
            parts.push('#/', d.virtual.virtualType, '/', encodeURIComponent(d.virtual.virtualPath));
        }

        return parts.join('');
    }

    /**
     * Builds a portal URL for this node. Only applicable to subscriptions,
     * resource groups, resources, and virtual resources. Throws for accounts,
     * tenants, and non-RG groupings.
     *
     * A virtual resource resolves to its parent resource's page unless it
     * declared a {@linkcode VirtualResource.portalUrl}, in which case that URL
     * is returned verbatim.
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

            // eslint-disable-next-line no-fallthrough -- Fallthrough is **intentional**, subs/resource groups/resources all use ARM resource ID-based URLs
            case 'subscription':
            case 'resource':
                return buildPortalUrl(d.portalHost, d.tenantId, d.armResourceId);

            case 'virtual':
                return d.virtual.portalUrl ?? buildPortalUrl(d.portalHost, d.tenantId, d.armResourceId);
        }
    }

    /**
     * Returns this node's parent identifier in the
     * **ARM structural hierarchy** as an {@linkcode AzureNodeId}, or `undefined` for root (account) nodes.
     *
     * This always reflects the ARM resource model:
     *  - Virtual resource  -> its parent generic resource
     *  - Generic resource  -> its resource group
     *  - Resource group    -> its subscription
     *  - Virtual grouping  -> its subscription
     *  - Subscription      -> its tenant
     *  - Tenant            -> its account
     *  - Account           -> `undefined`
     *
     * **Note:** This does not account for view-layer grouping strategies
     * (e.g. `resourceType`, `location`). Under those strategies a
     * generic resource's view-layer parent is a virtual group node, not
     * a resource group. View providers must handle that case before
     * falling through to this method.
     */
    public parentNodeId(): AzureNodeId | undefined {
        const d = this.data;
        switch (d.kind) {
            case 'account':
                return undefined;
            case 'tenant':
                return new AzureNodeId({ kind: 'account', accountId: d.accountId, portalHost: d.portalHost });
            case 'subscription':
                return new AzureNodeId({ kind: 'tenant', accountId: d.accountId, portalHost: d.portalHost, tenantId: d.tenantId });
            case 'grouping':
                // Grouping nodes (both resource group and virtual) sit under subscriptions.
                // The subscription ARM ID is /subscriptions/{id} -- the first two ARM segments.
                return new AzureNodeId({
                    kind: 'subscription',
                    accountId: d.accountId,
                    portalHost: d.portalHost,
                    tenantId: d.tenantId,
                    armResourceId: getSubscriptionArmId(d.armResourceId),
                });
            case 'resource': {
                // Resource -> resource group. Extract /subscriptions/{id}/resourceGroups/{name}
                const parsedResource = parseAzureResourceId(d.armResourceId);
                if (!parsedResource.resourceGroup) {
                    // No resource group in the path (subscription-scoped resource) -- fall back to subscription
                    return new AzureNodeId({
                        kind: 'subscription',
                        accountId: d.accountId,
                        portalHost: d.portalHost,
                        tenantId: d.tenantId,
                        armResourceId: getSubscriptionArmId(d.armResourceId),
                    });
                }
                return new AzureNodeId({
                    kind: 'grouping',
                    accountId: d.accountId,
                    portalHost: d.portalHost,
                    tenantId: d.tenantId,
                    armResourceId: getResourceGroupArmId(d.armResourceId),
                    grouping: { groupingStrategy: 'resourceGroup' satisfies ResourceGroup['groupingStrategy'], groupingValue: parsedResource.resourceGroup },
                });
            }
            case 'virtual': {
                // Virtual resource -> its parent generic resource (strip the fragment)
                return new AzureNodeId({
                    kind: 'resource',
                    accountId: d.accountId,
                    portalHost: d.portalHost,
                    tenantId: d.tenantId,
                    armResourceId: d.armResourceId,
                });
            }
        }
    }

    /** Narrows this node ID to an {@linkcode AzureAccount} node ID. */
    public isAccountNodeId(): boolean {
        return this.data.kind === 'account';
    }

    /** Narrows this node ID to an {@linkcode AzureTenant} node ID. */
    public isTenantNodeId(): boolean {
        return this.data.kind === 'tenant';
    }

    /** Narrows this node ID to an {@linkcode AzureSubscription} node ID. */
    public isSubscriptionNodeId(): boolean {
        return this.data.kind === 'subscription';
    }

    /** Narrows this node ID to a {@linkcode VirtualGroup} node ID (non-RG grouping). */
    public isVirtualGroupNodeId(): boolean {
        return this.data.kind === 'grouping' && this.data.grouping.groupingStrategy !== 'resourceGroup';
    }

    /**
     * Narrows this node ID to a {@linkcode ResourceGroup} node ID.
     * A resource group is a grouping node whose strategy is `'resourceGroup'`.
     */
    public isResourceGroupNodeId(): boolean {
        return this.data.kind === 'grouping' && this.data.grouping.groupingStrategy === 'resourceGroup';
    }

    /** Narrows this node ID to a {@linkcode GenericResource} node ID. {@linkcode ResourceGroup} node IDs do **not** match, though they do conform to `GenericResource`. */
    public isGenericResourceNodeId(): boolean {
        return this.data.kind === 'resource';
    }

    /** Narrows this node ID to a {@linkcode VirtualResource} node ID. */
    public isVirtualResourceNodeId(): boolean {
        return this.data.kind === 'virtual';
    }

    /**
     * Builds the node ID of another ARM resource reachable through the same
     * account, tenant, and cloud as this node.
     *
     * Use this to cross a *reference* between resources that the tree does not
     * model as containment -- for example jumping from a container app to the
     * managed environment named by its `environmentId`. The target's own node
     * object may not be loaded yet, so its id has to be derived rather than
     * looked up.
     *
     * Only the ARM resource id differs; the identity segments are inherited
     * verbatim, which is what keeps the result inside this node's own account
     * and cloud.
     *
     * Node IDs are compared exactly, but ARM returns the structural keywords
     * (`subscriptions`, `resourceGroups`, `providers`) in varying case -- for
     * example `resourcegroups` in the identity ids of a site -- while listings use
     * the canonical form. They are canonicalized here so a reference resolves to
     * the same node a listing produced; names are never altered.
     *
     * @param armResourceId - Absolute ARM resource id of the target, starting
     *   with `/subscriptions/`.
     * @throws if this is an account node, which has no tenant to inherit, or if
     *   {@linkcode armResourceId} is not an absolute ARM resource id.
     */
    public forRelatedResource(armResourceId: string): AzureNodeId {
        const d = this.data;
        if (d.kind === 'account') {
            throw new Error('Cannot derive a related resource from an account node ID');
        }

        if (!/^\/subscriptions\//i.test(armResourceId)) {
            throw new Error(`Not an absolute ARM resource id: ${armResourceId}`);
        }

        return new AzureNodeId({
            kind: 'resource',
            accountId: d.accountId,
            portalHost: d.portalHost,
            tenantId: d.tenantId,
            armResourceId: canonicalizeArmKeywords(armResourceId),
        });
    }

    /**
     * Returns the grouping strategy and value for grouping nodes
     * (both resource groups and virtual groups), or `undefined` for
     * non-grouping nodes.
     */
    public getGrouping(): Pick<ResourceGroup | VirtualGroup, 'groupingStrategy' | 'groupingValue'> | undefined {
        return this.data.kind === 'grouping' ? this.data.grouping : undefined;
    }
}

/**
 * Extracts the portal hostname (e.g. `"portal.azure.com"`) from an
 * {@linkcode EnvironmentLike}'s `portalUrl`.
 *
 * Accepts any value carrying an `environment` (account, tenant, or
 * subscription) so callers can pass the node directly without first
 * resolving its owning account object.
 */
function portalHost(entity: { readonly environment: EnvironmentLike }): string {
    return new URL(entity.environment.portalUrl).hostname;
}

/**
 * Rewrites the structural keywords of an absolute ARM resource id to the casing
 * listings use (`/subscriptions/{id}/resourceGroups/{rg}/providers/...`).
 * Subscription ids, resource group names, and resource names are left untouched.
 */
function canonicalizeArmKeywords(armResourceId: string): string {
    return armResourceId
        .replace(/^\/subscriptions(?=\/)/i, '/subscriptions')
        .replace(/^(\/subscriptions\/[^/]+)\/resourcegroups(?=\/)/i, '$1/resourceGroups')
        .replace(/^(\/subscriptions\/[^/]+(?:\/resourceGroups\/[^/]+)?)\/providers(?=\/)/i, '$1/providers');
}

/** Builds the Azure Portal deep link for an absolute ARM resource id. */
function buildPortalUrl(portalHostName: string, tenantId: string, armResourceId: string): string {
    return `https://${portalHostName}/#@${tenantId}/resource${armResourceId}`;
}

/**
 * Rejects portal URLs a virtual node must not be allowed to declare.
 *
 * {@linkcode AzureNodeId} is the single authority for which cloud and tenant a
 * node belongs to, so an override is only honored when it stays inside the
 * account's own portal host. Requiring `https:` and a matching host keeps a
 * provider bug (or a hand-edited node id) from turning "Open in Portal" into a
 * link to an arbitrary site, and stops a sovereign-cloud node from silently
 * deep-linking into the commercial portal.
 *
 * Failing loudly here surfaces the bug in the provider that produced the node,
 * rather than at the point a user clicks "Open in Portal".
 *
 * @throws if the value is present but is not an absolute `https:` URL on
 * {@linkcode portalHostName}.
 */
function validatePortalUrl(value: string | undefined, portalHostName: string): string | undefined {
    if (value === undefined) {
        return undefined;
    }

    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error(`Invalid portal URL "${value}": expected an absolute URL`);
    }

    if (parsed.protocol !== 'https:') {
        throw new Error(`Invalid portal URL "${value}": expected the "https:" protocol`);
    }

    if (parsed.hostname.toLowerCase() !== portalHostName.toLowerCase()) {
        throw new Error(`Invalid portal URL "${value}": expected the host to be "${portalHostName}"`);
    }

    return value;
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
type VirtualData = SubscriptionFields & { readonly kind: 'virtual'; readonly virtual: Pick<VirtualResource, 'virtualType' | 'virtualPath' | 'portalUrl'> };
//#endregion
