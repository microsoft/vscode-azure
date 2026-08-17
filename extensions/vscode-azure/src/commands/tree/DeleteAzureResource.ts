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
import { IActionContext, ICodeContext, IOutputChannel, showMessage, showSmartInputBox, stringifyError, withDelayedProgress } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzdResourceAssociationService, type AzdResourceAssociation } from '../../azd/AzdResourceAssociationService';
import { AzdDownCommandId } from '../../constants';
import { IAzureViewDataTree } from '../../services';
import type { AzdDownOptions } from '../deploy/AzdDown';
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
 * {@linkcode AzdDownCommandId} so the whole deployment is torn down
 * consistently, but may still choose to delete the single resource.
 *
 * The node is removed from {@linkcode IAzureViewDataTree} only after Azure
 * reports the deletion complete, so a failure leaves the tree untouched.
 */
@injectable()
export class DeleteAzureResource implements ManagedCommand {
    /** Context value gating deletion of an individual resource. */
    public static readonly ResourceContextValue = 'deleteResource';

    /** Context value gating deletion of a resource group. */
    public static readonly ResourceGroupContextValue = 'deleteResourceGroup';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionContext) private readonly context: IActionContext,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
        @inject(IAzdResourceAssociationService) private readonly azdAssociation: IAzdResourceAssociationService,
        @inject(IResourceClientProvider) private readonly createClient: IResourceClientProvider,
    ) { }

    /**
     * @inheritdoc
     * @throws if the key is missing, stale, or does not identify a deletable node.
     * @throws {@linkcode CancellationError} if the user backs out at any prompt.
     */
    public async execute(key?: string): Promise<void> {
        const resource = this.resolve(key);
        this.context.telemetry.properties.nodeType = getNodeType(resource);

        if (await this.steerToAzdIfNeeded(resource)) {
            return;
        }

        await this.confirm(resource);

        await withDelayedProgress(
            this.ctx.code,
            {
                location: this.ctx.code.ProgressLocation.Notification,
                title: this.ctx.code.l10n.t('Deleting \'{0}\'...', resource.name),
            },
            this.deleteResource(resource),
        );

        this.dataTree.remove(resource);
        void showMessage(this.ctx.code, isResourceGroup(resource)
            ? this.ctx.code.l10n.t('Deleted resource group \'{0}\'.', resource.name)
            : this.ctx.code.l10n.t('Deleted resource \'{0}\'.', resource.name));
    }

    /** Look up the selected node and confirm it is something we can delete. */
    private resolve(key: string | undefined): GenericResource {
        if (!key) {
            throw new Error(this.ctx.code.l10n.t('Select an Azure resource to delete.'));
        }

        const resource = this.dataTree.get(key);
        if (!resource) {
            throw new Error(this.ctx.code.l10n.t('The selected Azure resource is no longer available. Refresh the view and try again.'));
        }

        if (!isGenericResource(resource) && !isResourceGroup(resource)) {
            throw new Error(this.ctx.code.l10n.t('The selected item cannot be deleted.'));
        }

        return resource;
    }

    /**
     * Offer to tear down the owning azd deployment instead of deleting a single
     * Azure target.
     *
     * @returns `true` when `azd down` handled the teardown, so no direct
     * deletion should follow.
     * @throws {@linkcode CancellationError} if the user dismisses the prompt.
     */
    private async steerToAzdIfNeeded(resource: GenericResource): Promise<boolean> {
        const association = await this.findAzdAssociation(resource);
        this.context.telemetry.properties.azdAssociated = String(!!association);
        if (!association) {
            this.context.telemetry.properties.deletionPath = 'direct';
            return false;
        }

        const deleteDeployment = this.ctx.code.l10n.t('Delete Deployment');
        const deleteDirectly = isResourceGroup(resource)
            ? this.ctx.code.l10n.t('Delete Resource Group Anyway')
            : this.ctx.code.l10n.t('Delete Resource Anyway');
        const choice = await showMessage(
            this.ctx.code,
            isResourceGroup(resource)
                ? this.ctx.code.l10n.t('This resource group is managed by a local Azure Developer CLI project. Delete the full deployment instead?')
                : this.ctx.code.l10n.t('This resource is managed by a local Azure Developer CLI project. Delete the full deployment instead?'),
            { modal: true, severity: 'warning', stepName: 'confirmAzdDeletionChoice' },
            deleteDeployment,
            deleteDirectly,
        );

        if (choice === deleteDeployment) {
            this.context.telemetry.properties.deletionPath = 'azdDown';
            // Deliberately not skipping the confirmation: tearing down the whole
            // deployment is broader than what the user selected, so AzdDown must
            // state that scope before --force --purge runs. This mirrors the
            // direct path, which also confirms after this steering prompt.
            const options: AzdDownOptions = { environmentName: association.environmentName };
            await this.ctx.code.commands.executeCommand(AzdDownCommandId, association.azureYamlUri, options);
            return true;
        }

        this.context.telemetry.properties.deletionPath = 'direct';
        return false;
    }

    /**
     * Find the azd project owning {@linkcode resource}, treating a failed
     * lookup as "not azd-managed".
     *
     * The lookup shells out to `azd`, which is optional -- an uninstalled or
     * failing CLI must not make a resource undeletable. Falling through to the
     * direct path is the safe default: it still requires its own confirmation
     * and only ever deletes the selected target, never a whole deployment.
     */
    private async findAzdAssociation(resource: GenericResource): Promise<AzdResourceAssociation | undefined> {
        try {
            return await this.azdAssociation.find(resource);
        } catch (error) {
            this.context.telemetry.properties.azdLookupFailed = 'true';
            this.output.debug(`[delete] azd association lookup failed: ${stringifyError(error)}`);
            return undefined;
        }
    }

    /**
     * Ask the user to confirm, requiring the typed name for cascading deletes.
     *
     * @throws {@linkcode CancellationError} if the user dismisses the prompt.
     */
    private async confirm(resource: GenericResource): Promise<void> {
        if (isResourceGroup(resource)) {
            // Validation blocks acceptance until the name matches, so returning
            // at all means the user confirmed; cancelling rejects instead.
            //
            // The name is deliberately never remembered: a recalled value would
            // satisfy the validation immediately and reduce this speed bump to
            // a single Enter.
            await showSmartInputBox(this.ctx, {
                rememberRecent: false,
                prompt: this.ctx.code.l10n.t('Type \'{0}\' to confirm deletion of this resource group and everything in it.', resource.name),
                validateInput: input => input === resource.name
                    ? undefined
                    : this.ctx.code.l10n.t('Enter \'{0}\' to confirm deletion.', resource.name),
            });
            return;
        }

        const deleteLabel = this.ctx.code.l10n.t('Delete');
        await showMessage(
            this.ctx.code,
            this.ctx.code.l10n.t('Are you sure you want to delete resource \'{0}\'? This cannot be undone.', resource.name),
            { modal: true, severity: 'warning', stepName: 'confirmResourceDeletion' },
            deleteLabel,
        );
    }

    /** Issue the ARM delete and resolve once Azure reports it complete. */
    private deleteResource(resource: GenericResource): Promise<void> {
        const client = this.createClient(resource.subscription);
        return isResourceGroup(resource)
            ? client.resourceGroups.delete(resource.name)
            : client.resources.deleteById(resource.id, resource.type);
    }}


