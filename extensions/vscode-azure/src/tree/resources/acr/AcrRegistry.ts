/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Sku as AcrSku, GenericResource } from '@microsoft/vscode-azure-azutils';
import { AcrResourceType, isGenericResource } from '@microsoft/vscode-azure-azutils';

/**
 * A {@linkcode GenericResource} that has been enriched with ACR-specific
 * properties fetched from the ARM management API.
 *
 * Created by {@linkcode AcrDataProvider.enrich} via `Object.assign`, so the
 * underlying object remains the same reference stored in the
 * {@linkcode DataItemTree}.
 */
export interface AcrRegistry extends GenericResource {
    /** The URL that can be used to log into the container registry. */
    readonly loginServer: string | undefined;
    /** The SKU of the container registry. */
    readonly sku: AcrSku | undefined;
    /** Whether the admin user is enabled. */
    readonly adminUserEnabled: boolean | undefined;
}

/**
 * An {@linkcode AcrRegistry} whose enrichment has completed, guaranteeing
 * that all service-specific properties are populated.
 *
 * Obtain this type by awaiting {@linkcode DataItemTree.whenEnriched}:
 *
 * ```ts
 * const registry = await cache.whenEnriched<EnrichedAcrRegistry>(resource);
 * registry.loginServer; // string
 * ```
 */
export interface EnrichedAcrRegistry extends GenericResource {
    readonly loginServer: string;
    readonly sku: AcrSku;
    readonly adminUserEnabled: boolean;
}

/**
 * Type guard that narrows an unknown value to an {@linkcode AcrRegistry}.
 *
 * Returns `true` for `GenericResource` nodes whose `logicalType` matches
 * `Microsoft.ContainerRegistry/registries`. The node may or may not
 * have been enriched yet -- use the presence of `loginServer` to
 * distinguish enriched from un-enriched registries when needed.
 */
export function isAcrRegistry(node: unknown): node is AcrRegistry {
    return isGenericResource(node)
        && node.logicalType.toLowerCase() === AcrResourceType.toLowerCase();
}
