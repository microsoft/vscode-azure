/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, isVirtualResource } from '@microsoft/vscode-azure-azutils';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable, optional } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Opens the selected tree node in the Azure Portal in an external browser.
 * No-op for nodes that do not have a portal URL (e.g., accounts, tenants).
 */
@injectable()
export class OpenInPortal implements ManagedCommand {
    /** Context value gating this command's visibility in the tree view. */
    public static ContextValue = 'openInPortal';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzureViewDataTree) @optional() private readonly cache?: IAzureViewDataTree,
    ) { }

    /** @inheritdoc */
    public execute(key: string): void {
        let portalUrl = AzureNodeId.parse(key).toPortalUrl();
        const resource = this.cache?.get(key);
        if (resource && isVirtualResource(resource) && 'portalResourceId' in resource
            && typeof resource.portalResourceId === 'string') {
            const rootId = resource.azureResource.id;
            if (portalUrl.endsWith(rootId)) {
                portalUrl = `${portalUrl.slice(0, -rootId.length)}${resource.portalResourceId}`;
            }
        }

        if (portalUrl) {
            void this.code.env.openExternal(this.code.Uri.parse(portalUrl));
        }
    }
}
