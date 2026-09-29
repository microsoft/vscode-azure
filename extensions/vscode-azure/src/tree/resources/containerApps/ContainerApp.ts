/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Container, GenericResource } from '@microsoft/vscode-azure-azutils';
import { isGenericResource } from '@microsoft/vscode-azure-azutils';

/**
 * The ARM resource type string for Azure Container Apps.
 */
export const ContainerAppResourceType = 'Microsoft.App/containerApps';

/**
 * A {@linkcode GenericResource} with lazily enriched container-app properties.
 *
 * Created by `ContainerAppsDataProvider.enrich` via `Object.assign`, so the
 * underlying object remains the same reference stored in the data tree.
 */
export interface ContainerApp extends GenericResource {
    /**
     * ARM ID of the managed environment hosting this app.
     *
     * Read from `properties.environmentId`. The SDK also exposes
     * `managedEnvironmentId`, which it marks as deprecated -- prefer this one.
     *
     * An app's own ARM ID contains no trace of its environment, so this is the
     * only way to get from an app to the environment that hosts it.
     */
    readonly environmentId: string | undefined;
    /** Provisioning state reported by ARM, e.g. `Succeeded` or `Failed`. */
    readonly provisioningState: string | undefined;
    /** Name of the app's most recent revision, used to target revision operations. */
    readonly latestRevisionName: string | undefined;
    /** Containers declared by the app's current template; undefined until enrichment finishes. */
    readonly containers: readonly Container[] | undefined;
}

/**
 * Type guard that narrows an unknown value to a {@linkcode ContainerApp}.
 *
 * Matches on `logicalType`, so it returns `true` whether or not the node has
 * been enriched yet. Use the presence of {@linkcode ContainerApp.containers} to
 * tell an enriched app from an un-enriched one.
 */
export function isContainerApp(node: unknown): node is ContainerApp {
    return isGenericResource(node)
        && node.logicalType.toLowerCase() === ContainerAppResourceType.toLowerCase();
}
