/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerAppResourceType, getResourceGroupName, IContainerAppsClientProvider } from '@microsoft/vscode-azure-azutils';
import { IVsCode, selfOnly, showMessage, withDelayedProgress } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import type { ContainerApp } from '../../tree/resources/containerApps/ContainerApp';
import { isContainerApp } from '../../tree/resources/containerApps/ContainerApp';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Restarts a container app's latest revision.
 *
 * Restarting is a revision-scoped operation in ARM even in single-revision
 * mode, so the app's latest revision is resolved from enrichment first. An app
 * that has never produced a revision cannot be restarted, and says so rather
 * than failing inside the SDK call.
 */
@injectable()
export class RestartContainerApp implements ManagedCommand {
    /** Context value gating this command's visibility in the tree view. */
    public static ContextValue = 'restartContainerApp';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
        @inject(IContainerAppsClientProvider) private readonly createClient: IContainerAppsClientProvider,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
    ) { }

    /** @inheritdoc */
    public async execute(key?: string): Promise<void> {
        const resource = await this.selector.selectResource({ logicalTypes: [ContainerAppResourceType], key });
        if (!isContainerApp(resource)) {
            return;
        }

        const app = await withDelayedProgress(
            this.code,
            {
                location: this.code.ProgressLocation.Notification,
                title: this.code.l10n.t('Loading details for \'{0}\'...', resource.name),
            },
            this.selector.whenEnriched<ContainerApp>(resource),
        );

        const revisionName = app.latestRevisionName;
        if (!revisionName) {
            throw new Error(this.code.l10n.t('\'{0}\' has no revision to restart. Deploy the app first.', app.name));
        }

        const client = this.createClient(app.subscription);

        await withDelayedProgress(
            this.code,
            {
                location: this.code.ProgressLocation.Notification,
                title: this.code.l10n.t('Restarting \'{0}\'...', app.name),
            },
            client.containerAppsRevisions.restartRevision(
                getResourceGroupName(app.id),
                app.name,
                revisionName,
            ),
        );

        // Restarting replaces the running replicas but not the app's template,
        // so only the app's own rendering can change -- its children are
        // unaffected and should not be dropped.
        this.tree.invalidate(selfOnly(app));

        void showMessage(this.code, this.code.l10n.t('Restarted \'{0}\'.', app.name));
    }
}
