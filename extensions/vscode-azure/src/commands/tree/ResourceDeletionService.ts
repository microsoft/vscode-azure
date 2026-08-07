/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getNodeType, isGenericResource, isResourceGroup, isVirtualResource } from '@microsoft/vscode-azure-azutils';
import { IActionContext, IVsCode, withDelayedProgress } from '@microsoft/vscode-azure-utils';
import { Container, inject, injectable } from 'inversify';
import { IAzdResourceAssociationService } from '../../azd/AzdResourceAssociationService';
import type { ResourceDeletionConfirmation } from '../../registration/ResourceDeletionProvider';
import { IAzureViewDataTree } from '../../services';
import { AzdDown } from '../deploy/AzdDown';
import { ResourceDeletionResolver } from './ResourceDeletionResolver';

/** The two generic deletion entry points exposed by the resource tree. */
export type ResourceDeletionKind = 'resource' | 'resourceGroup';

/** Coordinates confirmation, execution, and tree updates for resource deletion. */
@injectable()
export class ResourceDeletionService {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionContext) private readonly context: IActionContext,
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
        @inject(IAzdResourceAssociationService) private readonly azdAssociation: IAzdResourceAssociationService,
        @inject(ResourceDeletionResolver) private readonly resolver: ResourceDeletionResolver,
        @inject(Container) private readonly container: Container,
    ) { }

    /**
     * Delete the tree node identified by {@linkcode key}.
     *
     * @throws if the key is absent, stale, or does not match the command kind.
     */
    public async delete(key: string | undefined, kind: ResourceDeletionKind): Promise<void> {
        if (!key) {
            throw new Error(this.code.l10n.t('Select an Azure resource to delete.'));
        }

        const resource = this.dataTree.get(key);
        if (!resource) {
            throw new Error(this.code.l10n.t('The selected Azure resource is no longer available. Refresh the view and try again.'));
        }

        if (
            (kind === 'resourceGroup' && !isResourceGroup(resource))
            || (kind === 'resource' && !isGenericResource(resource) && !isVirtualResource(resource))
        ) {
            throw new Error(this.code.l10n.t('The selected item cannot be deleted by this command.'));
        }

        this.context.telemetry.properties.nodeType = getNodeType(resource);
        const plan = await this.resolver.resolve(resource);
        this.context.telemetry.properties.deletionProvider = plan.telemetryType ?? 'generic';

        if (plan.azdTarget) {
            const association = await this.azdAssociation.find(plan.azdTarget);
            this.context.telemetry.properties.azdAssociated = String(!!association);
            if (association) {
                const deleteDeployment = this.code.l10n.t('Delete Deployment');
                const deleteDirectly = kind === 'resourceGroup'
                    ? this.code.l10n.t('Delete Resource Group Anyway')
                    : this.code.l10n.t('Delete Resource Anyway');
                const associationMessage = kind === 'resourceGroup'
                    ? this.code.l10n.t('This resource group is managed by a local Azure Developer CLI project. Delete the full deployment instead?')
                    : this.code.l10n.t('This resource is managed by a local Azure Developer CLI project. Delete the full deployment instead?');
                const choice = await this.code.window.showWarningMessage(
                    associationMessage,
                    { modal: true },
                    deleteDeployment,
                    deleteDirectly,
                );
                if (choice === deleteDeployment) {
                    this.context.telemetry.properties.deletionPath = 'azdDown';
                    await this.container.get(AzdDown).execute(association.azureYamlUri, {
                        skipConfirmation: true,
                        environmentName: association.environmentName,
                    });
                    return;
                } else if (choice !== deleteDirectly) {
                    return;
                }
            }
        }

        this.context.telemetry.properties.deletionPath = 'direct';
        if (!await this.confirm(plan.confirmation)) {
            return;
        }

        await withDelayedProgress(
            this.code,
            {
                location: this.code.ProgressLocation.Notification,
                title: this.code.l10n.t('Deleting \'{0}\'...', plan.resourceName),
            },
            plan.delete(),
        );
        this.dataTree.remove(plan.cacheTarget);
        void this.code.window.showInformationMessage(plan.successMessage);
    }

    private async confirm(confirmation: ResourceDeletionConfirmation): Promise<boolean> {
        if (confirmation.kind === 'modal') {
            const deleteLabel = this.code.l10n.t('Delete');
            const choice = await this.code.window.showWarningMessage(
                confirmation.message,
                { modal: true },
                deleteLabel,
            );
            return choice === deleteLabel;
        }

        const value = await this.code.window.showInputBox({
            prompt: confirmation.prompt,
            validateInput: input => input === confirmation.expectedValue
                ? undefined
                : this.code.l10n.t('Enter \'{0}\' to confirm deletion.', confirmation.expectedValue),
        });
        return value === confirmation.expectedValue;
    }
}
