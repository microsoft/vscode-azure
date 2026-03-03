/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode, pickFromTree } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree, IAzureViewViewItemTree } from '../services';
import type { EnrichedAcrRegistry } from '../tree/acr/AcrRegistry';
import { isAcrRegistry } from '../tree/acr/AcrRegistry';
import { createAzurePickOptions } from '../tree/createAzurePickOptions';
import type { ManagedCommand } from './ManagedCommand';

// TODO: remove this demonstration command
@injectable()
export class DisableAcrAdminUser implements ManagedCommand {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
        @inject(IAzureViewViewItemTree) private readonly viewTree: IAzureViewViewItemTree, // TODO: a single selector service that can accept pick options and give back the resolved resource (either from quick pick or from cache)?
    ) { }

    public async execute(key?: string): Promise<void> {
        if (!key) {
            key = await pickFromTree(this.code, this.viewTree, createAzurePickOptions(this.code, {
                title: this.code.l10n.t('Disable ACR Admin User'),
                terminalContextValue: 'azureContainerRegistry',
                targetResourceType: 'Microsoft.ContainerRegistry/registries',
            }));

            if (!key) {
                return;
            }
        }

        const resource = this.cache.get(key);
        if (!resource || !isAcrRegistry(resource)) {
            return;
        }

        const registry = await this.code.window.withProgress(
            {
                location: this.code.ProgressLocation.Notification,
                title: this.code.l10n.t('Loading details for \'{0}\'...', resource.name),
            },
            () => this.cache.whenEnriched<EnrichedAcrRegistry>(resource),
        );

        void this.code.window.showInformationMessage(
            this.code.l10n.t('If this command were real, it would disable admin user on \'{0}\' (loginServer: {1}, sku: {2}).', registry.name, registry.loginServer, registry.sku.name)
        );
    }
}
