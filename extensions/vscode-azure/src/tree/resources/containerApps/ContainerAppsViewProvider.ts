/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, getNodeType, isGenericResource, type VirtualResource } from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, ICodeContext, type ITreeItem, type ViewProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { OpenContainerAppConsole, OpenContainerAppLogs } from '../../../commands/containerApps/portalBlades';
import { RestartContainerApp } from '../../../commands/containerApps/RestartContainerApp';
import { RevealContainerAppEnvironment } from '../../../commands/containerApps/RevealContainerAppEnvironment';
import { StartStreamingLogs } from '../../../commands/containerApps/StartStreamingLogs';
import { StopStreamingLogs } from '../../../commands/containerApps/StopStreamingLogs';
import { IAzureViewDataTree } from '../../../services';
import { resourceContextValue } from '../../contextValueHelpers';
import { getResourceTypeIconUri } from '../../iconPath';
import { isContainerApp, type ContainerApp } from './ContainerApp';
import { IContainerAppLogStreamService } from './ContainerAppLogStream';
import { isContainerNode } from './ContainerAppsDataProvider';
import { isManagedEnvironment } from './ManagedEnvironment';

/** Context value carried by the container nodes beneath a container app. */
export const ContainerContextValue = 'containerAppContainer';

/**
 * View-layer provider for Azure Container Apps, their managed environments, and
 * the containers declared by an app's template.
 *
 * A container renders as a leaf whose `description` and `tooltip` carry the
 * image it runs: the image is a property of the container, not a level above or
 * below it, so it gets no node of its own.
 */
@injectable()
export class ContainerAppsViewProvider implements ViewProvider<string> {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
        @inject(IContainerAppLogStreamService) private readonly streams: IContainerAppLogStreamService,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is string {
        if (typeof resource !== 'string' || !AzureNodeId.test(resource)) {
            return false;
        }

        const node = this.tree.get(resource);
        return isContainerApp(node) || isManagedEnvironment(node) || isContainerNode(node);
    }

    /** @inheritdoc */
    public async getChildren(key: string): Promise<string[]> {
        const resource = this.tree.get(key);
        if (!isContainerApp(resource)) {
            return [];
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));
        return (await this.tree.getChildren(resource)).map(child => AzureNodeId.from(child).toString());
    }

    /** @inheritdoc */
    public getTreeItem(key: string): ITreeItem {
        const resource = this.tree.get(key);
        if (!resource) {
            return new this.ctx.code.TreeItem(key);
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));

        if (isContainerNode(resource)) {
            return this.createContainerTreeItem(resource, key);
        }

        if (!isGenericResource(resource)) {
            throw new Error('Expected an Azure resource or virtual resource');
        }

        // An app expands to its containers; an environment is a leaf, because
        // the apps it hosts are siblings rooted in their own resource groups
        // and its true ARM children are out of scope.
        const app = isContainerApp(resource) ? resource : undefined;

        const item = new this.ctx.code.TreeItem(
            resource.name,
            app
                ? this.ctx.code.TreeItemCollapsibleState.Collapsed
                : this.ctx.code.TreeItemCollapsibleState.None,
        );
        item.id = key;
        item.iconPath = getResourceTypeIconUri(this.ctx, resource.logicalType);
        item.contextValue = app
            ? resourceContextValue(resource, ...this.appContextValues(app))
            : resourceContextValue(resource);
        item.description = app ? this.describeAppState(app) : undefined;

        return item;
    }

    /**
     * Context values for the commands that act on a container app.
     *
     * Stopping a stream is only offered while one is open, so the node has to be
     * re-rendered when that changes -- the log-stream service invalidates it.
     */
    private appContextValues(resource: ContainerApp): string[] {
        const values = [
            OpenContainerAppConsole.ContextValue,
            OpenContainerAppLogs.ContextValue,
            RestartContainerApp.ContextValue,
            StartStreamingLogs.ContextValue,
        ];

        if (resource.environmentId) {
            values.push(RevealContainerAppEnvironment.ContextValue);
        }

        if (this.streams.isStreaming(resource.id)) {
            values.push(StopStreamingLogs.ContextValue);
        }

        return values;
    }

    /** @inheritdoc */
    public getParent(key: string): string | undefined {
        return AzureNodeId.parse(key).parentNodeId()?.toString();
    }

    /**
     * Describes an app that is not in a steady, successful state. A healthy app
     * gets no description, so the tree stays quiet until there is something
     * worth saying.
     */
    private describeAppState(resource: ContainerApp): string | undefined {
        const state = resource.provisioningState;
        return state && state.toLowerCase() !== 'succeeded' ? state : undefined;
    }

    private createContainerTreeItem(resource: VirtualResource, key: string): ITreeItem {
        const item = new this.ctx.code.TreeItem(resource.virtualPath, this.ctx.code.TreeItemCollapsibleState.None);
        item.id = key;
        item.contextValue = ContainerContextValue;
        item.iconPath = new this.ctx.code.ThemeIcon('package');

        const image = this.findContainerImage(resource);
        if (image) {
            item.description = shortenImageReference(image);
            item.tooltip = new this.ctx.code.MarkdownString(
                `**${this.ctx.code.l10n.t('Image')}**: \`${image}\``,
            );
        }

        return item;
    }

    /**
     * Reads the image from the owning app's enriched template rather than
     * storing it on the virtual node, so a redeploy that changes the image is
     * picked up by the next render without re-keying the node.
     */
    private findContainerImage(resource: VirtualResource): string | undefined {
        const app = resource.azureResource;
        if (!isContainerApp(app)) {
            return undefined;
        }

        return app.containers.find((container, index) =>
            (container.name ?? `container-${index}`) === resource.virtualPath)?.image;
    }
}

/**
 * Drops the registry host from an image reference so the tree shows
 * `repository:tag` inline, leaving the fully qualified reference for the
 * tooltip.
 *
 * Per the OCI/Docker reference grammar the first segment is a registry only
 * when it contains a `.` or a `:`, or is exactly `localhost`; otherwise it is
 * the first part of the repository path on the default registry.
 */
export function shortenImageReference(image: string): string {
    const firstSlash = image.indexOf('/');
    if (firstSlash < 0) {
        return image;
    }

    const head = image.slice(0, firstSlash);
    const isRegistryHost = head === 'localhost' || head.includes('.') || head.includes(':');
    return isRegistryHost ? image.slice(firstSlash + 1) : image;
}
