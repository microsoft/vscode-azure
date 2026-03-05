/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode, withDelayedProgress } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../services';
import type { EnrichedAcrRegistry } from '../tree/acr/AcrRegistry';
import { isAcrRegistry } from '../tree/acr/AcrRegistry';
import type { ManagedCommand } from './ManagedCommand';

// TODO: remove this demonstration command
@injectable()
export class DisableAcrAdminUser implements ManagedCommand {
    public static ContextValue = 'disableAcrAdminUser';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
    ) { }

    public async execute(key: string): Promise<void> {
        const resource = this.cache.get(key);
        if (!resource || !isAcrRegistry(resource)) {
            return;
        }

        const registry = await withDelayedProgress(
            this.code,
            {
                location: this.code.ProgressLocation.Notification,
                title: this.code.l10n.t('Loading details for \'{0}\'...', resource.name),
            },
            this.cache.whenEnriched<EnrichedAcrRegistry>(resource),
        );

        void this.code.window.showInformationMessage(
            this.code.l10n.t('If this command were real, it would disable admin user on \'{0}\' (loginServer: {1}, sku: {2}).', registry.name, registry.loginServer, registry.sku.name)
        );
    }
}
