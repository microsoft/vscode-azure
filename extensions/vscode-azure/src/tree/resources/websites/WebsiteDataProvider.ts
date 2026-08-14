/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AppServiceLogicalType, getNodeType, getResourceGroupName, isGenericResource, IWebAppClientProvider, StaticWebAppType,
    type ConcreteAzureNode, type GenericResource
} from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, type DataProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { setWebsiteUrl } from '../websiteUrl';

/**
 * Data-layer provider for App Service web apps and Static Web Apps.
 *
 * These resources are leaves in the tree; the provider exists so that
 * enrichment can attach their public website URL, which is what makes the
 * Browse Website command available on them.
 *
 * Function apps are `Microsoft.Web/sites` too, but they carry their own
 * logical type and are owned by `FunctionAppDataProvider`, which attaches the
 * website URL itself.
 */
@injectable()
export class WebsiteDataProvider implements DataProvider<ConcreteAzureNode> {
    public constructor(
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IWebAppClientProvider) private readonly createClient: IWebAppClientProvider,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is ConcreteAzureNode {
        return isWebsite(resource);
    }

    /**
     * @inheritdoc
     *
     * Fetches the resource's default hostname and attaches it as the node's
     * website URL.
     *
     * @throws if the resource's ARM ID does not contain a resource group segment.
     */
    public async enrich(resource: ConcreteAzureNode): Promise<boolean> {
        if (!isWebsite(resource)) {
            return false;
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));

        const client = this.createClient(resource.subscription);
        const resourceGroupName = getResourceGroupName(resource.id);

        setWebsiteUrl(resource, isStaticWebApp(resource)
            ? (await client.staticSites.getStaticSite(resourceGroupName, resource.name)).defaultHostname
            : (await client.webApps.get(resourceGroupName, resource.name)).defaultHostName);

        return false;
    }

    /** @inheritdoc */
    public getChildren(): ConcreteAzureNode[] {
        return [];
    }
}

function isWebsite(node: unknown): node is GenericResource {
    return !!node && typeof node === 'object' && isGenericResource(node as GenericResource)
        && ((node as GenericResource).logicalType.toLowerCase() === AppServiceLogicalType.toLowerCase()
            || isStaticWebApp(node as GenericResource));
}

function isStaticWebApp(node: GenericResource): boolean {
    return node.type.toLowerCase() === StaticWebAppType.toLowerCase();
}
