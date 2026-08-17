/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- referenced by {@linkcode} in JSDoc below
import type { AzureNodeId } from './AzureNodeId';
import type { GenericResource } from './GenericResource';

/**
 * A non-ARM tree node nested under an existing {@linkcode GenericResource},
 * used by service-specific providers to represent sub-resources (such
 * as container repositories or tags) that are not themselves top-level
 * ARM resources.
 */
export interface VirtualResource {
    /** A provider-defined discriminator (e.g. `'repository'`, `'tag'`). */
    readonly virtualType: string;
    /** Path within the parent resource identifying this virtual node. */
    readonly virtualPath: string;
    /** The parent ARM resource that owns this virtual node. */
    readonly azureResource: GenericResource;
    /**
     * The Azure Portal URL this node should open, when the portal has a page
     * for it that is distinct from {@linkcode VirtualResource.azureResource}'s.
     *
     * Most virtual nodes are presentation-only groupings with no portal page of
     * their own, so this is left unset and the portal opens the parent resource
     * instead. Set it only when the portal genuinely has a separate page -- for
     * example a Static Web Apps "Functions" node, which the portal addresses as
     * `{staticSiteId}/builds/{buildId}/functions` rather than as the site.
     *
     * Must be an absolute `https:` URL whose host matches the portal host of
     * the owning account, so a node can never link out of its own cloud. Build
     * it from the parent subscription's environment `portalUrl` rather than
     * hardcoding `portal.azure.com`.
     *
     * It is carried in the node's {@linkcode AzureNodeId}, so it must be
     * derived deterministically from the node's own data -- a value that varies
     * between refreshes would change the node's identity.
     */
    readonly portalUrl?: string;
}
