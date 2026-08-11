/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource } from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable, multiInject, type ServiceIdentifier } from 'inversify';
import { getAzdServiceIngressUrl, IAzdService } from '../azd/AzdService';
import { AzdEnvNameTag } from '../constants';

/** Identifier for the ordered collection of product-contributed endpoint providers. */
export const IResourceEndpointProviders: ServiceIdentifier<ResourceEndpointProvider> = Symbol.for('IResourceEndpointProviders');

/**
 * Resolves a browser endpoint for one family of Azure resources.
 *
 * Providers must keep {@linkcode ResourceEndpointProvider.canHandle canHandle}
 * synchronous because tree view rendering uses it to decide whether to expose
 * the Browse Website command.
 */
export interface ResourceEndpointProvider {
    /** Return whether this provider owns endpoint resolution for the resource. */
    canHandle(resource: GenericResource): boolean;

    /** Query the product API for the resource's current endpoint, if deployed. */
    getEndpoint(resource: GenericResource): Promise<string | undefined>;
}

/** Identifier for the shared resource endpoint capability resolver. */
export const IResourceEndpointResolver: ServiceIdentifier<IResourceEndpointResolver> = Symbol.for('IResourceEndpointResolver');

/** Resolves browsable endpoints while preferring an exact azd resource association. */
export interface IResourceEndpointResolver {
    /** Return whether a product has contributed endpoint support for the resource. */
    canHandle(resource: GenericResource): boolean;

    /** Return a normalized HTTP(S) URL for the resource, if one is currently available. */
    resolve(resource: GenericResource): Promise<string | undefined>;
}

/**
 * Coordinates azd endpoint discovery with product-specific ARM fallbacks.
 *
 * azd is preferred because a project may override a service's endpoint in
 * `azure.yaml`, which cannot be derived from ARM. It is queried only on command
 * execution, and its result is accepted only when a service target contains the
 * selected resource's full ARM ID.
 */
@injectable()
export class ResourceEndpointResolver implements IResourceEndpointResolver {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IAzdService) private readonly azd: IAzdService,
        @multiInject(IResourceEndpointProviders) private readonly providers: readonly ResourceEndpointProvider[],
    ) { }

    /** @inheritdoc */
    public canHandle(resource: GenericResource): boolean {
        return this.providers.some(provider => provider.canHandle(resource));
    }

    /** @inheritdoc */
    public async resolve(resource: GenericResource): Promise<string | undefined> {
        return await this.resolveFromAzd(resource) ?? await this.resolveFromProvider(resource);
    }

    private async resolveFromProvider(resource: GenericResource): Promise<string | undefined> {
        const provider = this.providers.find(candidate => candidate.canHandle(resource));
        if (!provider) {
            return undefined;
        }

        const endpoint = normalizeEndpoint(await provider.getEndpoint(resource));
        if (!endpoint) {
            this.executor.output.debug('[endpoint] product provider returned no usable endpoint');
        }
        return endpoint;
    }

    private async resolveFromAzd(resource: GenericResource): Promise<string | undefined> {
        if (!this.code.workspace.workspaceFolders?.length) {
            return undefined;
        }

        const azureYamls = await this.azd.findAzureYaml();
        const environmentName = resource.tags?.[AzdEnvNameTag];
        const resourceId = normalizeResourceId(resource.id);
        const visitedFolders = new Set<string>();

        for (const azureYaml of azureYamls) {
            const folder = this.code.Uri.joinPath(azureYaml, '..');
            const folderKey = folder.toString().toLowerCase();
            if (visitedFolders.has(folderKey)) {
                continue;
            }
            visitedFolders.add(folderKey);

            const showResult = await this.azd.show(folder, environmentName);
            for (const service of Object.values(showResult?.services ?? {})) {
                if (!service.target?.resourceIds?.some(id => normalizeResourceId(id) === resourceId)) {
                    continue;
                }

                const endpoint = normalizeEndpoint(getAzdServiceIngressUrl(service));
                if (endpoint) {
                    return endpoint;
                }
                this.executor.output.debug('[endpoint] azd target returned no usable endpoint');
            }
        }

        return undefined;
    }
}

function normalizeResourceId(resourceId: string): string {
    return resourceId.replace(/\/+$/, '').toLowerCase();
}

/**
 * Converts an endpoint to an absolute HTTP(S) URL, rejecting anything a browser
 * should not be sent to. ARM reports bare hostnames while azd reports absolute
 * URLs, so a value without a scheme is assumed to be HTTPS.
 */
function normalizeEndpoint(endpoint: string | undefined): string | undefined {
    const value = endpoint?.trim();
    if (!value) {
        return undefined;
    }

    try {
        const url = new URL(value.includes('://') ? value : `https://${value}`);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
    } catch {
        return undefined;
    }
}
