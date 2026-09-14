/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupName, IContainerAppsClientProvider, type IContainerAppsClient, type Replica, type ReplicaContainer, type Revision } from '@microsoft/vscode-azure-azutils';
import {
    collectAsync, ICodeContext, showSmartQuickPick, withDelayedProgress,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
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
        const client = this.createClient(app.subscription);

        const revisionName = (typeof target === 'object' ? target.revisionName : undefined)
            ?? await this.pickRevision(client, app.name, resourceGroupName);
        const replica = await this.pickReplica(client, app.name, resourceGroupName, revisionName);
        const container = await this.pickContainer(replica);
        if (!container.logStreamEndpoint) {
            throw new Error(this.ctx.code.l10n.t(
                'No log stream is available for container \'{0}\'. It may not be running yet.',
                container.name,
            ));
        }

        await this.streams.start({
            app, revisionName, replicaName: replica.name,
            containerName: container.name, logStreamEndpoint: container.logStreamEndpoint,
        });
    }

    private async pickRevision(client: IContainerAppsClient, appName: string, resourceGroupName: string): Promise<string> {
        const revisions = await withDelayedProgress(
            this.ctx.code,
            {
                location: this.ctx.code.ProgressLocation.Notification,
                title: this.ctx.code.l10n.t('Loading revisions for \'{0}\'...', appName),
            },
            collectAsync(client.containerAppsRevisions.listRevisions(resourceGroupName, appName)),
        );

        // An inactive revision runs nothing, so it has no logs to stream.
        const active = revisions.filter(revision => revision.active !== false);
        if (active.length === 0) {
            throw new Error(this.ctx.code.l10n.t('\'{0}\' has no active revisions to stream logs from.', appName));
        }

        const picked = await this.pick(
            active.map(revision => ({
                label: revision.name,
                description: describeRevision(revision),
                data: revision,
            })),
            this.ctx.code.l10n.t('Select a revision'),
        );

        return picked.data.name;
    }

    private async pickReplica(client: IContainerAppsClient, appName: string, resourceGroupName: string, revisionName: string): Promise<Replica & { name: string }> {
        const replicas = await withDelayedProgress(
            this.ctx.code,
            {
                location: this.ctx.code.ProgressLocation.Notification,
                title: this.ctx.code.l10n.t('Loading replicas for \'{0}\'...', revisionName),
            },
            client.containerAppsRevisionReplicas.listReplicas(resourceGroupName, appName, revisionName),
        );

        const named = replicas.filter((replica): replica is Replica & { name: string } => !!replica.name);
        if (named.length === 0) {
            // A revision scaled to zero has no replicas, and therefore nothing
            // to stream -- this is ordinary, not an error in the request.
            throw new Error(this.ctx.code.l10n.t(
                'Revision \'{0}\' has no running replicas. It may be scaled to zero.',
                revisionName,
            ));
        }

        const picked = await this.pick(
            named.map(replica => ({
                label: replica.name,
                description: replica.runningState,
                data: replica,
            })),
            this.ctx.code.l10n.t('Select a replica'),
        );

        return picked.data;
    }

    private async pickContainer(replica: Replica): Promise<ReplicaContainer & { name: string }> {
        const containers = (replica.containers ?? [])
            .filter((container): container is ReplicaContainer & { name: string } => !!container.name);

        if (containers.length === 0) {
            throw new Error(this.ctx.code.l10n.t('Replica \'{0}\' reports no containers.', replica.name ?? ''));
        }

        const picked = await this.pick(
            containers.map(container => ({
                label: container.name,
                description: container.runningState,
                data: container,
            })),
            this.ctx.code.l10n.t('Select a container'),
        );

        return picked.data;
    }

    private async pick<T extends vscode.QuickPickItem>(items: T[], placeHolder: string): Promise<T> {
        return items.length === 1 ? items[0] : showSmartQuickPick(this.ctx, items, { placeHolder, showBack: true });
    }
}

/** Summarizes a revision for the pick list. */
function describeRevision(revision: Revision): string | undefined {
    return revision.runningState ?? revision.provisioningState;
}
