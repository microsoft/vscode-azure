/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isGenericResource } from '@microsoft/vscode-azure-azutils';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IResourceEndpointResolver } from '../../endpoints/ResourceEndpointResolver';
import { IAzureViewDataTree } from '../../services';
import type { UrlProvider, UrlProviderIdentifier } from '../OpenUrl';

/** Identifier for the {@linkcode BrowseWebsite} URL provider binding. */
export const IBrowseWebsite: UrlProviderIdentifier = Symbol.for('IBrowseWebsite');

/**
 * Resolves the website endpoint of the selected Azure resource tree node.
 *
 * Registered as a URL source for {@linkcode OpenUrl} rather than as its own
 * command, so browsing shares the standard URL-command behavior.
 */
@injectable()
export class BrowseWebsite implements UrlProvider {
    /** Context value gating this command's visibility in the resource tree. */
    public static readonly ContextValue = 'browseWebsite';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
        @inject(IResourceEndpointResolver) private readonly endpointResolver: IResourceEndpointResolver,
    ) { }

    /**
     * @inheritdoc
     * @throws if the selection is not an Azure resource, its type has no
     *   endpoint support, or it has not been deployed yet.
     */
    public async getUrl(...args: unknown[]): Promise<string | undefined> {
        const [key] = args;
        const resource = typeof key === 'string' ? this.dataTree.get(key) : undefined;
        if (!resource || !isGenericResource(resource)) {
            throw new Error(this.code.l10n.t('Select an Azure resource with a website endpoint.'));
        }

        if (!this.endpointResolver.canHandle(resource)) {
            throw new Error(this.code.l10n.t('The selected resource type does not support website browsing.'));
        }

        const endpoint = await this.endpointResolver.resolve(resource);
        if (!endpoint) {
            throw new Error(this.code.l10n.t('The selected resource does not have a website endpoint yet.'));
        }

        return endpoint;
    }
}
