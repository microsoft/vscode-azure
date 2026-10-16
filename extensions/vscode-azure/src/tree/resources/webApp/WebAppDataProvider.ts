/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getNodeType, getResourceGroupName, IWebAppClientProvider, type ConcreteAzureNode, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, type DataProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { WebAppSettingsAdapter } from '../../../settings/adapters/WebAppSettingsAdapter';
import { getSettingsNodes } from '../settings/SettingsNode';
import { setWebsiteUrl } from '../websiteUrl';
import { isWebApp } from './WebApp';

/**
 * Owns Function App, App Service, and Logic App resources so their shared application-settings
 * adapter can contribute the settings virtual node.
 */
@injectable()
export class WebAppDataProvider implements DataProvider<ConcreteAzureNode> {
    public constructor(
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IWebAppClientProvider) private readonly createClient: IWebAppClientProvider,
        @inject(WebAppSettingsAdapter) private readonly settingsAdapter: WebAppSettingsAdapter,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is GenericResource {
        return isWebApp(resource);
    }

    /** @inheritdoc */
    public async enrich(resource: ConcreteAzureNode): Promise<boolean> {
        if (!isWebApp(resource)) {
            return false;
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));
        try {
            const client = this.createClient(resource.subscription);
            const site = await client.webApps.get(getResourceGroupName(resource.id), resource.name);
            resource.site = site;
            setWebsiteUrl(resource, site.defaultHostName);
            return false;
        } catch (error: unknown) {
            resource.site = undefined;
            throw error;
        }
    }

    /** @inheritdoc */
    public getChildren(resource?: ConcreteAzureNode): ConcreteAzureNode[] {
        return isWebApp(resource) ? getSettingsNodes(resource, this.settingsAdapter) : [];
    }
}
