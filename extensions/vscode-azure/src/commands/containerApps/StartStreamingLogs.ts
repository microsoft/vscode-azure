/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupName, IContainerAppsClientProvider, type Replica, type ReplicaContainer, type Revision } from '@microsoft/vscode-azure-azutils';
import {
    collectAsync, ICodeContext, IVsCode, showSmartQuickPick, withDelayedProgress,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IContainerAppLogStreamService, type LogStreamApp } from '../../tree/resources/containerApps/ContainerAppLogStream';
import type { ContainerApp } from '../../tree/resources/containerApps/ContainerApp';
import { ContainerAppResourceType, isContainerApp } from '../../tree/resources/containerApps/ContainerApp';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import type { ManagedCommand } from '../ManagedCommand';

/** Explicit activity target; a known revision is never replaced by revision selection. */
export type StartStreamingLogsRequest =
    | { readonly kind: 'system'; readonly app: LogStreamApp }
    | { readonly kind: 'console'; readonly app: LogStreamApp; readonly revisionName?: string };

/**
 * Streams live logs from one container of one running replica.
 *
 * The user picks down the revision -> replica -> container chain, but each pick
 * is skipped when it has only one candidate: the common single-revision,
 * single-replica, single-container app opens its stream with no prompts at all.
 */
@injectable()
export class StartStreamingLogs implements ManagedCommand {
    /** Shared command for tree, palette, and explicit activity targets. */
    public static readonly CommandId = 'vscode-azure/containerApps/startStreamingLogs';
    /** Context value gating this command's visibility in the tree view. */
    public static ContextValue = 'startContainerAppLogStream';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
        @inject(IContainerAppsClientProvider) private readonly createClient: IContainerAppsClientProvider,
        @inject(IContainerAppLogStreamService) private readonly streams: IContainerAppLogStreamService,
    ) { }

    /** @inheritdoc */
    public async execute(target?: string | StartStreamingLogsRequest): Promise<void> {
        if (typeof target === 'object' && target.kind === 'system') {
            await this.streams.start(target);
            return;
        }

        let app: LogStreamApp;
        if (typeof target === 'object') {
            app = target.app;
        } else {
            const resource = await this.selector.selectResource({ logicalType: ContainerAppResourceType, key: target });
            if (!isContainerApp(resource)) {
                return;
            }
            app = await this.selector.whenEnriched<ContainerApp>(resource);
        }
        const resourceGroupName = getResourceGroupName(app.id);

        const revisionName = (typeof target === 'object' ? target.revisionName : undefined)
            ?? await this.pickRevision(app, resourceGroupName);
        const replica = await this.pickReplica(app, resourceGroupName, revisionName);
        const containerName = await this.pickContainer(replica);

        await this.streams.start({ app, revisionName, replicaName: replica.name, containerName });
    }

    private async pickRevision(app: LogStreamApp, resourceGroupName: string): Promise<string> {
        const client = this.createClient(app.subscription);

        const revisions = await withDelayedProgress(
            this.code,
            {
                location: this.code.ProgressLocation.Notification,
                title: this.code.l10n.t('Loading revisions for \'{0}\'...', app.name),
            },
            collectAsync(client.containerAppsRevisions.listRevisions(resourceGroupName, app.name)),
        );

        // An inactive revision runs nothing, so it has no logs to stream.
        const active = revisions.filter(revision => revision.active !== false);
        if (active.length === 0) {
            throw new Error(this.code.l10n.t('\'{0}\' has no active revisions to stream logs from.', app.name));
        }

        if (active.length === 1) {
            return active[0].name;
        }

        const picked = await showSmartQuickPick(
            this.ctx,
            active.map(revision => ({
                label: revision.name,
                description: describeRevision(revision),
                data: revision,
            })),
            { placeHolder: this.code.l10n.t('Select a revision'), showBack: true },
        );

        return picked.data.name;
    }

    private async pickReplica(app: LogStreamApp, resourceGroupName: string, revisionName: string): Promise<Replica & { name: string }> {
        const client = this.createClient(app.subscription);

        const replicas = await withDelayedProgress(
            this.code,
            {
                location: this.code.ProgressLocation.Notification,
                title: this.code.l10n.t('Loading replicas for \'{0}\'...', revisionName),
            },
            client.containerAppsRevisionReplicas.listReplicas(resourceGroupName, app.name, revisionName),
        );

        const named = replicas.filter((replica): replica is Replica & { name: string } => !!replica.name);
        if (named.length === 0) {
            // A revision scaled to zero has no replicas, and therefore nothing
            // to stream -- this is ordinary, not an error in the request.
            throw new Error(this.code.l10n.t(
                'Revision \'{0}\' has no running replicas. It may be scaled to zero.',
                revisionName,
            ));
        }

        if (named.length === 1) {
            return named[0];
        }

        const picked = await showSmartQuickPick(
            this.ctx,
            named.map(replica => ({
                label: replica.name,
                description: replica.runningState,
                data: replica,
            })),
            { placeHolder: this.code.l10n.t('Select a replica'), showBack: true },
        );

        return picked.data;
    }

    private async pickContainer(replica: Replica): Promise<string> {
        const containers = (replica.containers ?? [])
            .filter((container): container is ReplicaContainer & { name: string } => !!container.name);

        if (containers.length === 0) {
            throw new Error(this.code.l10n.t('Replica \'{0}\' reports no containers.', replica.name ?? ''));
        }

        if (containers.length === 1) {
            return containers[0].name;
        }

        const picked = await showSmartQuickPick(
            this.ctx,
            containers.map(container => ({
                label: container.name,
                description: container.runningState,
                data: container,
            })),
            { placeHolder: this.code.l10n.t('Select a container'), showBack: true },
        );

        return picked.data.name;
    }
}

/** Summarizes a revision for the pick list. */
function describeRevision(revision: Revision): string | undefined {
    return revision.runningState ?? revision.provisioningState;
}
