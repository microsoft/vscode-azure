/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStaticWebAppClientProvider, parseAzureResourceId } from '@microsoft/vscode-azure-azutils';
import { ExternalError, IActionContext, IVsCode, showMessage } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { IGenericActivityDataProvider } from '../../tree/activity/GenericActivityDataProvider';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import { getStaticWebAppEnvironmentLabel, isStaticWebAppEnvironment } from '../../tree/resources/staticWebApps/StaticWebApp';
import type { ManagedCommand } from '../ManagedCommand';

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
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
        @inject(IGenericActivityDataProvider) private readonly activityProvider: IGenericActivityDataProvider,
    ) { }

    /** @inheritdoc */
    public async execute(key?: string): Promise<void> {
        const environment = await this.selector.selectVirtual({ key, canHandle: isStaticWebAppEnvironment });
        this.context.telemetry.properties.isProduction = String(environment.isProduction);
        if (environment.isProduction) {
            throw new ExternalError(this.code.l10n.t('Cannot delete the production environment directly. Delete the Static Web App instead.'));
        }

        const label = getStaticWebAppEnvironmentLabel(this.code, environment);
        await showMessage(
            this.code,
            this.code.l10n.t('Are you sure you want to delete environment \'{0}\'? This cannot be undone.', label),
            { modal: true, severity: 'warning', stepName: 'confirmStaticWebAppEnvironmentDeletion' },
            this.code.l10n.t('Delete'),
        );

        const { resourceGroup } = parseAzureResourceId(environment.azureResource.id);
        if (!resourceGroup) {
            throw new Error(this.code.l10n.t('Could not determine the resource group for the selected Static Web App.'));
        }
        const client = this.createClient(environment.azureResource.subscription);
        const activity = this.activityProvider.trackActivity({
            title: this.code.l10n.t('Delete environment \'{0}\'', label),
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

        this.dataTree.remove(environment);
    }
}
