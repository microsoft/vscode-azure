/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isGenericResource } from '@microsoft/vscode-azure-azutils';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IResourceEndpointResolver } from '../../endpoints/ResourceEndpointResolver';
import { IAzureViewDataTree } from '../../services';
import type { ManagedCommand } from '../ManagedCommand';
import { OpenUrl } from '../OpenUrl';

/** Opens the selected Azure resource's primary HTTP endpoint in a browser. */
@injectable()
export class BrowseWebsite implements ManagedCommand {
    /** Context value gating this command's visibility in the resource tree. */
    public static readonly ContextValue = 'browseWebsite';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
        @inject(IResourceEndpointResolver) private readonly endpointResolver: IResourceEndpointResolver,
        @inject(OpenUrl) private readonly openUrl: OpenUrl,
    ) { }

    /** @inheritdoc */
    public async execute(key?: string): Promise<void> {
        const resource = key ? this.dataTree.get(key) : undefined;
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

        await this.openUrl.execute(endpoint);
    }
}
