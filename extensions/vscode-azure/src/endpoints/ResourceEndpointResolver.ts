/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource } from '@microsoft/vscode-azure-azutils';
import type { IActionExecutor, IVsCode } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import { getAzdServiceIngressUrl, type IAzdService } from '../azd/AzdService';
import { AzdEnvNameTag } from '../constants';
import type { ResourceEndpointProvider } from './ResourceEndpointProvider';

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
 * Azd is queried only on command execution. Its result is accepted only when a
 * service target contains the selected resource's full ARM ID.
 */
export class ResourceEndpointResolver implements IResourceEndpointResolver {
    public constructor(
        private readonly code: IVsCode,
        private readonly executor: IActionExecutor,
        private readonly azd: IAzdService,
        private readonly providers: readonly ResourceEndpointProvider[],
    ) { }

    /** @inheritdoc */
    public canHandle(resource: GenericResource): boolean {
        return this.providers.some(provider => provider.canHandle(resource));
    }

    /** @inheritdoc */
    public async resolve(resource: GenericResource): Promise<string | undefined> {
        const azdEndpoint = normalizeEndpoint(await this.resolveFromAzd(resource));
        if (azdEndpoint) {
            return azdEndpoint;
        }

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
        const workspaceCount = this.code.workspace.workspaceFolders?.length ?? 0;
        if (workspaceCount === 0) {
            return undefined;
        }

        const azureYamls = await this.azd.findAzureYaml(undefined, workspaceCount * 2);
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
                const isTargetResource = service.target?.resourceIds?.some(id => normalizeResourceId(id) === resourceId);
                const endpoint = getAzdServiceIngressUrl(service);
                if (isTargetResource) {
                    if (normalizeEndpoint(endpoint)) {
                        return endpoint;
                    }
                    this.executor.output.debug('[endpoint] azd target returned no usable endpoint');
                }
            }
        }

        return undefined;
    }
}

function normalizeResourceId(resourceId: string): string {
    return resourceId.replace(/\/+$/, '').toLowerCase();
}

function normalizeEndpoint(endpoint: string | undefined): string | undefined {
    const value = endpoint?.trim();
    if (!value) {
        return undefined;
    }

    if (/^[a-z][a-z\d+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) {
        return undefined;
    }

    const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : undefined;
    } catch {
        return undefined;
    }
}
