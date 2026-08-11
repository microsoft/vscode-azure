/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getNodeType,
    IResourceClientProvider,
    isGenericResource,
    isResourceGroup,
    type GenericResource,
} from '@microsoft/vscode-azure-azutils';
import { IActionContext, ICodeContext, showSmartInputBox, withDelayedProgress } from '@microsoft/vscode-azure-utils';
import { Container, inject, injectable } from 'inversify';
import { IAzdResourceAssociationService } from '../../azd/AzdResourceAssociationService';
import { IAzureViewDataTree } from '../../services';
import { AzdDown } from '../deploy/AzdDown';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Deletes an Azure resource or resource group selected in the resources tree.
 *
 * A single class backs both tree commands; the behavior is derived from the
 * selected node rather than from the command it was invoked through. Resource
 * groups cascade, so they require the user to type the group name, while
 * individual resources use a modal confirmation.
 *
 * When the target belongs to a local azd project, the user is steered toward
 * {@linkcode AzdDown} so the whole deployment is torn down consistently, but
 * may still choose to delete the single resource.
 *
 * The node is removed from {@linkcode IAzureViewDataTree} only after Azure
 * reports the deletion complete, so a failure leaves the tree untouched.
 */
@injectable()
export class DeleteAzureResource implements ManagedCommand {
    /** Context value gating deletion of an individual resource. */
    public static readonly ContextValue = 'deleteResource';

    /** Context value gating deletion of a resource group. */
    public static readonly ResourceGroupContextValue = 'deleteResourceGroup';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionContext) private readonly context: IActionContext,
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
        @inject(IAzdResourceAssociationService) private readonly azdAssociation: IAzdResourceAssociationService,
        @inject(IResourceClientProvider) private readonly createClient: IResourceClientProvider,
        @inject(Container) private readonly container: Container,
    ) { }

    private get code() {
        return this.ctx.code;
    }

    /**
     * @inheritdoc
     * @throws if the key is missing, stale, or does not identify a deletable node.
     */
    public async execute(key?: string): Promise<void> {
        const resource = this.resolve(key);
        this.context.telemetry.properties.nodeType = getNodeType(resource);

        if (await this.steerToAzd(resource)) {
            return;
        }

        if (!await this.confirm(resource)) {
            return;
        }

        await withDelayedProgress(
            this.code,
            {
                location: this.code.ProgressLocation.Notification,
                title: this.code.l10n.t('Deleting \'{0}\'...', resource.name),
            },
            this.deleteResource(resource),
        );

        this.dataTree.remove(resource);
        void this.code.window.showInformationMessage(isResourceGroup(resource)
            ? this.code.l10n.t('Deleted resource group \'{0}\'.', resource.name)
            : this.code.l10n.t('Deleted resource \'{0}\'.', resource.name));
    }

    /** Look up the selected node and confirm it is something we can delete. */
    private resolve(key: string | undefined): GenericResource {
        if (!key) {
            throw new Error(this.code.l10n.t('Select an Azure resource to delete.'));
        }

        const resource = this.dataTree.get(key);
        if (!resource) {
            throw new Error(this.code.l10n.t('The selected Azure resource is no longer available. Refresh the view and try again.'));
        }

        if (!isGenericResource(resource) && !isResourceGroup(resource)) {
            throw new Error(this.code.l10n.t('The selected item cannot be deleted.'));
        }

        return resource;
    }

    /**
     * Offer to tear down the owning azd deployment instead of deleting a single
     * Azure target.
     *
     * @returns `true` when the deletion has been handled (either by running
     * `azd down` or because the user dismissed the prompt).
     */
    private async steerToAzd(resource: GenericResource): Promise<boolean> {
        const association = await this.azdAssociation.find(resource);
        this.context.telemetry.properties.azdAssociated = String(!!association);
        if (!association) {
            this.context.telemetry.properties.deletionPath = 'direct';
            return false;
        }

        const deleteDeployment = this.code.l10n.t('Delete Deployment');
        const deleteDirectly = isResourceGroup(resource)
            ? this.code.l10n.t('Delete Resource Group Anyway')
            : this.code.l10n.t('Delete Resource Anyway');
        const choice = await this.code.window.showWarningMessage(
            isResourceGroup(resource)
                ? this.code.l10n.t('This resource group is managed by a local Azure Developer CLI project. Delete the full deployment instead?')
                : this.code.l10n.t('This resource is managed by a local Azure Developer CLI project. Delete the full deployment instead?'),
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
            return true;
        }

        this.context.telemetry.properties.deletionPath = 'direct';
        return choice !== deleteDirectly;
    }

    /**
     * Ask the user to confirm, requiring the typed name for cascading deletes.
     *
     * @returns `false` when a modal confirmation is dismissed.
     * @throws {@linkcode CancellationError} if a typed confirmation is dismissed.
     */
    private async confirm(resource: GenericResource): Promise<boolean> {
        if (isResourceGroup(resource)) {
            // Validation blocks acceptance until the name matches, so returning
            // at all means the user confirmed; cancelling rejects instead.
            await showSmartInputBox(this.ctx, {
                prompt: this.code.l10n.t('Type \'{0}\' to confirm deletion of this resource group and everything in it.', resource.name),
                validateInput: input => input === resource.name
                    ? undefined
                    : this.code.l10n.t('Enter \'{0}\' to confirm deletion.', resource.name),
            });
            return true;
        }

        const deleteLabel = this.code.l10n.t('Delete');
        const choice = await this.code.window.showWarningMessage(
            this.code.l10n.t('Are you sure you want to delete resource \'{0}\'? This cannot be undone.', resource.name),
            { modal: true },
            deleteLabel,
        );
        return choice === deleteLabel;
    }

    /** Issue the ARM delete and resolve once Azure reports it complete. */
    private deleteResource(resource: GenericResource): Promise<void> {
        const client = this.createClient(resource.subscription);
        return isResourceGroup(resource)
            ? client.resourceGroups.delete(resource.name)
            : client.resources.deleteById(resource.id, resource.type);
    }
}
