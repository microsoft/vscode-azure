/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConcreteAzureNode, GenericResource } from '@microsoft/vscode-azure-azutils';
import { IResourceClientProvider, isGenericResource, isResourceGroup } from '@microsoft/vscode-azure-azutils';
import { inject, injectable } from 'inversify';
import type { PropertiesAdapter } from '../PropertiesAdapter';

/**
 * Fields this repo attaches to an ARM response that were never part of it.
 *
 * They are dropped so the document shows the resource as Azure describes it, and so the owning
 * account's identity -- which {@linkcode GenericResource.subscription} carries -- never lands in a
 * file the user may share.
 */
const attachedMetadata = new Set<string>(['subscription', 'logicalType'] satisfies (keyof GenericResource)[]);

/**
 * Reads any ARM resource's properties through the generic by-id ARM GET.
 *
 * This needs no per-product code because ARM addresses every resource the same way and the
 * api-version, the usual blocker, is resolved from the provider metadata by `ResourceClient`. It is
 * bound from the last-registered product, so a product adapter that claims the same node always
 * wins dispatch and this is what everything else falls back to.
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
 */
@injectable()
export class GenericArmPropertiesAdapter implements PropertiesAdapter<GenericResource> {
    /**
     * @inheritdoc
     *
     * ARM's GET generally does not return credentials -- Azure keeps those behind separate
     * `listKeys`/`listSecrets` calls -- so for most resource types this changes nothing. It is on
     * because this adapter serves every provider there is, including the ones that do: an
     * Application Insights component returns its instrumentation key and connection string inline.
     */
    public readonly redact = true;

    public constructor(
        @inject(IResourceClientProvider) private readonly createClient: IResourceClientProvider,
    ) { }

    /** @inheritdoc */
    public canHandle(node: ConcreteAzureNode): node is GenericResource {
        return isGenericResource(node) || isResourceGroup(node);
    }

    /**
     * @inheritdoc
     * @throws if ARM rejects the read, including when no api-version can be resolved for the
     *   resource's type.
     */
    public async read(node: GenericResource): Promise<unknown> {
        const client = this.createClient(node.subscription);
        const resource = await client.resources.getById(node.id, node.type);

        return Object.fromEntries(
            Object.entries(resource).filter(([key]) => !attachedMetadata.has(key)),
        );
    }
}
