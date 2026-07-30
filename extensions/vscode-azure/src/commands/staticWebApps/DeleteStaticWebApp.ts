/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStaticWebAppClientProvider, parseAzureResourceId } from '@microsoft/vscode-azure-azutils';
import { CancellationError, IOutputChannel, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { ManagedCommand } from '../ManagedCommand';
import { StaticWebAppCommandResolver } from './StaticWebAppCommandResolver';

/** Deletes an Azure Static Web App after explicit modal confirmation. */
@injectable()
export class DeleteStaticWebApp implements ManagedCommand {
    /** Context value for Static Web App root tree items. */
    public static readonly ContextValue = 'deleteStaticWebApp';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(IStaticWebAppClientProvider) private readonly createClient: IStaticWebAppClientProvider,
        @inject(StaticWebAppCommandResolver) private readonly resolver: StaticWebAppCommandResolver,
    ) { }

    /** @inheritdoc */
    public async execute(key?: string): Promise<void> {
        const site = await this.resolver.resolveSite(key);
        const deleteLabel = this.code.l10n.t('Delete');
        const confirmation = await this.code.window.showWarningMessage(
            this.code.l10n.t('Are you sure you want to delete Static Web App \'{0}\'?', site.name),
            { modal: true },
            deleteLabel,
        );
        if (confirmation !== deleteLabel) {
            throw new CancellationError(undefined, 'Confirm Static Web App deletion');
        }

        const { resourceGroup } = parseAzureResourceId(site.id);
        if (!resourceGroup) {
            throw new Error(this.code.l10n.t('Could not determine the resource group for the selected Static Web App.'));
        }
        await this.createClient(site.subscription).staticSites.deleteStaticSite(resourceGroup, site.name);

        this.resolver.dataTree.remove(site);
        this.output.info('Static Web App deletion completed.');
        void this.code.window.showInformationMessage(
            this.code.l10n.t('Successfully deleted Static Web App \'{0}\'.', site.name),
        );
    }
}
