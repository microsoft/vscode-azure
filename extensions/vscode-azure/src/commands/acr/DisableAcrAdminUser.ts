/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { resourceExperience } from '@microsoft/vscode-azure-azutils';
import { ICodeContext, withDelayedProgress } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree, IAzureViewViewItemTree } from '../../services';
import type { EnrichedAcrRegistry } from '../../tree/resources/acr/AcrRegistry';
import { AcrResourceType, isAcrRegistry } from '../../tree/resources/acr/AcrRegistry';
import type { ManagedCommand } from '../ManagedCommand';

/* c8 ignore start */

// TODO: remove this demonstration command
@injectable()
export class DisableAcrAdminUser implements ManagedCommand {
    public static ContextValue = 'disableAcrAdminUser';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
        @inject(IAzureViewViewItemTree) private readonly viewTree: IAzureViewViewItemTree, // TODO: a single selector service that can accept pick options and give back the resolved resource (either from quick pick or from cache)?
    ) { }

    public async execute(key?: string): Promise<void> {
        if (!key) {
            key = await resourceExperience({
                ...this.ctx,
                viewItemTree: this.viewTree,
                dataItemTree: this.cache,
                logicalType: AcrResourceType
            });
        }

        const resource = this.cache.get(key);
        if (!resource || !isAcrRegistry(resource)) {
            return;
        }

        const registry = await withDelayedProgress(
            this.ctx.code,
            {
                location: this.ctx.code.ProgressLocation.Notification,
                title: this.ctx.code.l10n.t('Loading details for \'{0}\'...', resource.name),
            },
            this.cache.whenEnriched<EnrichedAcrRegistry>(resource),
        );

        void this.ctx.code.window.showInformationMessage(
            this.ctx.code.l10n.t('If this command were real, it would disable admin user on \'{0}\' (loginServer: {1}, sku: {2}).', registry.name, registry.loginServer, registry.sku.name)
        );
    }
}

/* c8 ignore stop */
