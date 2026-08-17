/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
     * ARM resource id the Azure Portal should open for this node, when the
     * portal models it as something more specific than
     * {@linkcode VirtualResource.azureResource}.
     *
     * Most virtual nodes are presentation-only groupings with no portal blade
     * of their own, so this is left unset and the portal opens the parent
     * resource. Set it only when the portal genuinely has a distinct page --
     * for example a Static Web Apps "Functions" node, whose portal id is
     * `{staticSiteId}/builds/{buildId}/functions` rather than the site itself.
     *
     * Must be an absolute ARM resource id (leading `/`). It is carried in the
     * node's `AzureNodeId`, so it must be derived deterministically
     * from the node's own data -- a value that varies between refreshes would
     * change the node's identity.
     */
    readonly portalResourceId?: string;
}
