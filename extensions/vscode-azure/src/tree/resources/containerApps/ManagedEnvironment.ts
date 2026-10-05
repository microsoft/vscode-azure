/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource } from '@microsoft/vscode-azure-azutils';
import { isGenericResource, ManagedEnvironmentResourceType } from '@microsoft/vscode-azure-azutils';

/**
 * Type guard that narrows an unknown value to a managed environment resource.
 *
 * A managed environment is a top-level ARM resource and a sibling of the
 * container apps it hosts, not their parent -- the tree renders it as a leaf.
 * Environments do own true ARM children (`certificates`, `managedCertificates`,
 * `daprComponents`, `storages`), none of which are in scope today.
 */
export function isManagedEnvironment(node: unknown): node is GenericResource {
    return isGenericResource(node)
        && node.logicalType.toLowerCase() === ManagedEnvironmentResourceType.toLowerCase();
}
