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
import { IActionContext, ICodeContext, showMessage, showSmartInputBox, withDelayedProgress } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { AzdEnvNameTag } from '../../constants';
import { IAzureViewDataTree } from '../../services';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Deletes an Azure resource or resource group selected in the resources tree.
 *
 * A single class backs both tree commands; the behavior is derived from the
 * selected node rather than from the command it was invoked through. Resource
 * groups cascade, so they require the user to type the group name, while
 * individual resources use a modal confirmation.
 *
 * Targets carrying the azd environment tag include guidance to consider
 * `azd down`, since direct deletion can leave the local project out of sync.
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
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
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
                prompt: hasAzdEnvironmentTag(resource)
                    ? this.ctx.code.l10n.t('Type \'{0}\' to confirm deletion of this resource group and everything in it. This resource group appears to have been deployed by Azure Developer CLI. Consider running \'azd down\' instead.', resource.name)
                    : this.ctx.code.l10n.t('Type \'{0}\' to confirm deletion of this resource group and everything in it.', resource.name),
                validateInput: input => input === resource.name
                    ? undefined
                    : this.ctx.code.l10n.t('Enter \'{0}\' to confirm deletion.', resource.name),
            });
            return;
        }

        const deleteLabel = this.ctx.code.l10n.t('Delete');
        await showMessage(
            this.ctx.code,
            hasAzdEnvironmentTag(resource)
                ? this.ctx.code.l10n.t('Are you sure you want to delete resource \'{0}\'? This cannot be undone. This resource appears to have been deployed by Azure Developer CLI. Consider running \'azd down\' instead.', resource.name)
                : this.ctx.code.l10n.t('Are you sure you want to delete resource \'{0}\'? This cannot be undone.', resource.name),
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
    }
}

function hasAzdEnvironmentTag(resource: GenericResource): boolean {
    return Object.keys(resource.tags ?? {}).some(tag => tag.toLowerCase() === AzdEnvNameTag.toLowerCase());
}
