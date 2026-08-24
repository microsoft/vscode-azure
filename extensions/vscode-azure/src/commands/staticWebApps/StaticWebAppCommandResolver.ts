/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StaticWebAppResourceType } from '@microsoft/vscode-azure-azutils';
import { ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import {
    isStaticWebApp,
    isStaticWebAppVirtualNode,
    type StaticWebApp,
    type StaticWebAppVirtualNode,
} from '../../tree/resources/staticWebApps/StaticWebApp';

/**
 * Resolves command arguments from Azure resource-view keys.
 *
 * Tree-only commands use {@linkcode resolveVirtual}; palette-visible resource
 * commands use {@linkcode resolveSite}, which falls back to the shared picker.
 */
@injectable()
export class StaticWebAppCommandResolver {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
    ) { }

    /** Resolves a Static Web App root, accepting a virtual descendant key. */
    public async resolveSite(key?: string): Promise<StaticWebApp> {
        if (!key) {
            const selected = await this.selector.select<StaticWebApp>(StaticWebAppResourceType);
            if (!isStaticWebApp(selected)) {
                throw new Error(this.ctx.code.l10n.t('The selected resource is not an Azure Static Web App.'));
            }
            return selected;
        }

        const resource = this.resolveKey(key);
        if (isStaticWebApp(resource)) {
            return resource;
        } else if (isStaticWebAppVirtualNode(resource)) {
            return resource.azureResource;
        }
        throw new Error(this.ctx.code.l10n.t('The selected resource is not an Azure Static Web App.'));
    }

    /** Resolves and validates a tree-only virtual node. */
    public resolveVirtual<T extends StaticWebAppVirtualNode>(
        key: string | undefined,
        guard: (resource: StaticWebAppVirtualNode) => resource is T,
    ): T {
        if (!key) {
            throw new Error(this.ctx.code.l10n.t('Run this command from an Azure Static Web Apps resource in the Resources view.'));
        }

        const resource = this.resolveKey(key);
        if (!isStaticWebAppVirtualNode(resource) || !guard(resource)) {
            throw new Error(this.ctx.code.l10n.t('The selected Azure Static Web Apps item does not support this command.'));
        }
        return resource;
    }

    private resolveKey(key: string): unknown {
        const resource = this.cache.get(key);
        if (!resource) {
            throw new Error(this.ctx.code.l10n.t('Resource not found in the resources view. Try refreshing the resources view and running the command again.'));
        }
        return resource;
    }
}
