/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    IResourceClientProvider,
    isGenericResource,
    isResourceGroup,
    type ConcreteAzureNode,
    type GenericResource,
} from '@microsoft/vscode-azure-azutils';
import { ICodeContext, showMessage, showSmartInputBox } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { AzdEnvNameTag } from '../../constants';
import { IAzureViewDataTree } from '../../services';
import { IGenericActivityDataProvider } from '../../tree/activity/GenericActivityDataProvider';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
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
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
        @inject(IResourceClientProvider) private readonly createClient: IResourceClientProvider,
        @inject(IGenericActivityDataProvider) private readonly activityProvider: IGenericActivityDataProvider,
    ) { }

    /**
     * @inheritdoc
     * @throws if the key is missing, stale, or does not identify a deletable node.
     * @throws {@linkcode CancellationError} if the user backs out at any prompt.
     */
    public async execute(key?: string): Promise<void> {
        const resource = this.selector.resolve({
            key,
            canHandle: isDeletable,
            messages: {
                missingKey: this.ctx.code.l10n.t('Select an Azure resource to delete.'),
                missingNode: this.ctx.code.l10n.t('The selected Azure resource is no longer available. Refresh the view and try again.'),
                invalidNode: this.ctx.code.l10n.t('The selected item cannot be deleted.'),
            },
        });

        await this.confirm(resource);

        const activity = this.activityProvider.trackActivity({
            title: isResourceGroup(resource)
                ? this.ctx.code.l10n.t('Delete resource group \'{0}\'', resource.name)
                : this.ctx.code.l10n.t('Delete resource \'{0}\'', resource.name),
        });

        try {
            await this.deleteResource(resource);
            activity.update({ status: 'Completed' });
        } catch (error) {
            activity.update({ status: 'Failed', error });
            throw error;
        }

        this.dataTree.remove(resource);
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

/**
 * Deletable targets: any ARM resource, plus resource groups, which are ARM
 * resources too but are excluded from {@linkcode isGenericResource} because
 * they are also a grouping concept in the tree.
 */
function isDeletable(node: ConcreteAzureNode): node is GenericResource {
    return isGenericResource(node) || isResourceGroup(node);
}

function hasAzdEnvironmentTag(resource: GenericResource): boolean {
    return Object.keys(resource.tags ?? {}).some(tag => tag.toLowerCase() === AzdEnvNameTag.toLowerCase());
}
