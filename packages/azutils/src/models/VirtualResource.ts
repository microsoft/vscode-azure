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
}
