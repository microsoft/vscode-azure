/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getNodeType, getResourceGroupName, IContainerAppsClientProvider, isVirtualResource,
    type ConcreteAzureNode, type VirtualResource,
} from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, type DataProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { setWebsiteUrl } from '../websiteUrl';
import { isContainerApp } from './ContainerApp';
import { isManagedEnvironment } from './ManagedEnvironment';

/**
 * Discriminator carried by the virtual nodes this provider creates for the
 * containers declared in a container app's template.
 */
export const ContainerVirtualType = 'containerApps.container';

/**
 * Data-layer provider for Azure Container Apps and their managed environments.
 *
 * Both ARM types are handled here because they are siblings, not parent and
 * child: a container app's ARM ID contains no trace of its environment, and
 * there is no "list the apps in this environment" endpoint. Each therefore
 * roots directly in its resource group, and the app-to-environment relationship
 * is surfaced as a command instead of as containment.
 */
@injectable()
export class ContainerAppsDataProvider implements DataProvider<ConcreteAzureNode> {
    public constructor(
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IContainerAppsClientProvider) private readonly createClient: IContainerAppsClientProvider,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is ConcreteAzureNode {
        return isContainerApp(resource) || isManagedEnvironment(resource) || isContainerNode(resource);
    }

    /**
     * @inheritdoc
     *
     * Fetches the full container app so the view layer can render its state,
     * its containers, and a browsable URL without further API calls. Managed
     * environments need nothing beyond what the resource listing already
     * provides, so they are skipped.
     */
    public async enrich(resource: ConcreteAzureNode): Promise<boolean> {
        if (!isContainerApp(resource)) {
            return false;
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));

        const client = this.createClient(resource.subscription);
        const app = await client.containerApps.get(getResourceGroupName(resource.id), resource.name);

        // `environmentId` supersedes the SDK's `managedEnvironmentId`, which is
        // marked deprecated; read the former and fall back only if ARM omits it.
        Object.assign(resource, {
            environmentId: app.environmentId ?? app.managedEnvironmentId,
            provisioningState: app.provisioningState,
            latestRevisionName: app.latestRevisionName,
            containers: app.template?.containers ?? [],
        });

        setWebsiteUrl(resource, app.configuration?.ingress?.fqdn);

        return true;
    }

    /**
     * @inheritdoc
     *
     * Containers hang directly off the app whether there is one or many -- a
     * grouping node would add a click without adding information.
     */
    public getChildren(resource?: ConcreteAzureNode): ConcreteAzureNode[] {
        if (!isContainerApp(resource)) {
            return [];
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));

        return (resource.containers ?? []).map((container, index) => ({
            virtualType: ContainerVirtualType,
            // Containers are only required to be unique by name within a
            // template, and ARM permits the name to be absent, so the index
            // keeps every node's identity stable and distinct.
            virtualPath: container.name ?? `container-${index}`,
            azureResource: resource,
        } satisfies VirtualResource));
    }
}

/** Type guard for the container virtual nodes this provider creates. */
export function isContainerNode(node: unknown): node is VirtualResource {
    return !!node && typeof node === 'object'
        && isVirtualResource(node as VirtualResource)
        && (node as VirtualResource).virtualType === ContainerVirtualType;
}
