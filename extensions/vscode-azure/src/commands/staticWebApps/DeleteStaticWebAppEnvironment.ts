/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStaticWebAppClientProvider, parseAzureResourceId } from '@microsoft/vscode-azure-azutils';
import { IActionContext, IVsCode, showMessage } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IGenericActivityDataProvider } from '../../tree/activity/GenericActivityDataProvider';
import { isStaticWebAppEnvironment, StaticWebAppVirtualTypes, type StaticWebAppEnvironment } from '../../tree/resources/staticWebApps/StaticWebApp';
import type { ManagedCommand } from '../ManagedCommand';
import { StaticWebAppCommandResolver } from './StaticWebAppCommandResolver';

/**
 * Deletes a non-production Static Web Apps environment after confirmation.
 *
 * Separate from the generic {@linkcode DeleteAzureResource}, which deletes an
 * ARM resource by id: an environment is a *build* of a static site rather than
 * a resource of its own, so it is removed through the Static Web Apps API.
 * Deleting the production environment means deleting the site, which is what
 * the generic command on the site node does.
 *
 * The node leaves the tree only after Azure reports the deletion complete, so
 * a failure leaves the tree untouched.
 */
@injectable()
export class DeleteStaticWebAppEnvironment implements ManagedCommand {
    /** Context value for environment tree items. */
    public static readonly ContextValue = 'deleteStaticWebAppEnvironment';

    public constructor(
        @inject(IActionContext) private readonly context: IActionContext,
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IStaticWebAppClientProvider) private readonly createClient: IStaticWebAppClientProvider,
        @inject(StaticWebAppCommandResolver) private readonly resolver: StaticWebAppCommandResolver,
        @inject(IGenericActivityDataProvider) private readonly activityProvider: IGenericActivityDataProvider,
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

        await showMessage(
            this.code,
            this.code.l10n.t('Are you sure you want to delete environment \'{0}\'? This cannot be undone.', environment.displayLabel),
            { modal: true, severity: 'warning', stepName: 'confirmStaticWebAppEnvironmentDeletion' },
            this.code.l10n.t('Delete'),
        );

        const { resourceGroup } = parseAzureResourceId(environment.azureResource.id);
        if (!resourceGroup) {
            throw new Error(this.code.l10n.t('Could not determine the resource group for the selected Static Web App.'));
        }
        const client = this.createClient(environment.azureResource.subscription);
        const activity = this.activityProvider.trackActivity({
            title: this.code.l10n.t('Delete environment \'{0}\'', environment.displayLabel),
        });

        try {
            await client.staticSites.deleteStaticSiteBuild(
                resourceGroup,
                environment.azureResource.name,
                environment.buildId,
            );
            activity.update({ status: 'Completed' });
        } catch (error) {
            activity.update({ status: 'Failed', error });
            throw error;
        }

        this.resolver.dataTree.remove(environment);
    }
}
