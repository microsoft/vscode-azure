/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConcreteAzureNode, GenericResource, ResourceGroup } from '@microsoft/vscode-azure-azutils';
import { isGenericResource, isResourceGroup } from '@microsoft/vscode-azure-azutils';
import { injectable } from 'inversify';
import type { PropertiesAdapter } from '../PropertiesAdapter';

/**
 * Fields this repo attaches to an ARM response that were never part of it.
 *
 * They are dropped so the document shows the resource as Azure describes it, and so the owning
 * account's identity -- which {@linkcode GenericResource.subscription} carries -- never lands in a
 * file the user may share.
 */
const attachedMetadata = new Set<string>([
    'subscription',
    'logicalType',
    'groupingStrategy',
    'groupingValue',
] satisfies (keyof ResourceGroup)[]);

/**
 * Shows the ARM properties already carried by a resolved resource node.
 *
 * It is bound from the last-registered product, so a product adapter that claims the same node
 * always wins dispatch and this is what everything else falls back to.
 *
 * Resource groups are served too, even though {@linkcode isGenericResource} excludes them. That
 * exclusion exists for call sites where a group needs *different* behavior -- deleting one goes
 * through a different API, and grouping treats it as a container rather than a leaf. Reading is not
 * one of those: a group has an ARM id and a resolvable api-version like anything else, and its
 * `managedBy`, tags, and provisioning state are worth the same look. Excluding it would be a hole
 * with no reason behind it.
 *
 * Nodes without an ARM id -- virtual sub-resources such as ACR repositories or settings documents --
 * are not claimed. Serving those is what a product adapter is for.
 *
 * It takes the default redaction rather than opting out. ARM's GET generally keeps credentials
 * behind separate `listKeys`/`listSecrets` calls, so for most resource types this changes nothing --
 * but this adapter serves every provider there is, including the ones that do return a credential
 * inline, such as an Application Insights component and its instrumentation key.
 */
@injectable()
export class GenericArmPropertiesAdapter implements PropertiesAdapter<GenericResource> {
    /** @inheritdoc */
    public canHandle(node: ConcreteAzureNode): node is GenericResource {
        return isGenericResource(node) || isResourceGroup(node);
    }

    /** @inheritdoc */
    public read(node: GenericResource): Promise<unknown> {
        return Promise.resolve(Object.fromEntries(
            Object.entries(node).filter(([key]) => !attachedMetadata.has(key)),
        ));
    }
}
