/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStaticWebAppClientProvider, parseAzureResourceId } from '@microsoft/vscode-azure-azutils';
import { CancellationError, IActionContext, IOutputChannel, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { StaticWebAppVirtualTypes, type StaticWebAppEnvironment } from '../../tree/resources/staticWebApps/StaticWebApp';
import type { ManagedCommand } from '../ManagedCommand';
import { isStaticWebAppEnvironment } from './BrowseStaticWebApp';
import { StaticWebAppCommandResolver } from './StaticWebAppCommandResolver';

/** Deletes a non-production Static Web Apps environment after confirmation. */
@injectable()
export class DeleteStaticWebAppEnvironment implements ManagedCommand {
    /** Context value for environment tree items. */
    public static readonly ContextValue = 'deleteStaticWebAppEnvironment';

    public constructor(
        @inject(IActionContext) private readonly context: IActionContext,
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(IStaticWebAppClientProvider) private readonly createClient: IStaticWebAppClientProvider,
        @inject(StaticWebAppCommandResolver) private readonly resolver: StaticWebAppCommandResolver,
    ) { }

    /** @inheritdoc */
    public async execute(key?: string): Promise<void> {
        const environment = this.resolver.resolveVirtual<StaticWebAppEnvironment>(
            key,
            resource => resource.virtualType === StaticWebAppVirtualTypes.Environment && isStaticWebAppEnvironment(resource),
        );
        this.context.telemetry.properties.isProduction = String(environment.isProduction);
        if (environment.isProduction) {
            this.context.errorHandling.suppress = 'reportIssue';
            throw new Error(this.code.l10n.t('Cannot delete the production environment directly. Delete the Static Web App instead.'));
        }

        const deleteLabel = this.code.l10n.t('Delete');
        const confirmation = await this.code.window.showWarningMessage(
            this.code.l10n.t('Are you sure you want to delete environment \'{0}\'?', environment.displayLabel),
            { modal: true },
            deleteLabel,
        );
        if (confirmation !== deleteLabel) {
            throw new CancellationError(undefined, 'Confirm Static Web Apps environment deletion');
        }

        const { resourceGroup } = parseAzureResourceId(environment.azureResource.id);
        if (!resourceGroup) {
            throw new Error(this.code.l10n.t('Could not determine the resource group for the selected Static Web App.'));
        }
        const client = this.createClient(environment.azureResource.subscription);
        await client.staticSites.deleteStaticSiteBuild(
            resourceGroup,
            environment.azureResource.name,
            environment.buildId,
        );

        this.resolver.dataTree.remove(environment);
        this.output.info('Static Web Apps environment deletion completed.');
        void this.code.window.showInformationMessage(
            this.code.l10n.t('Successfully deleted environment \'{0}\'.', environment.displayLabel),
        );
    }
}
