/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isGenericResource, type ConcreteAzureNode, type GenericResource } from '@microsoft/vscode-azure-azutils';
import type { DataProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { WebAppSettingsAdapter } from '../../../settings/adapters/WebAppSettingsAdapter';
import { getSettingsNodes } from '../settings/SettingsNode';

/**
 * Owns Function App, App Service, and Logic App resources so their shared application-settings
 * adapter can contribute the settings virtual node.
 */
@injectable()
export class WebAppDataProvider implements DataProvider<ConcreteAzureNode> {
    public constructor(
        @inject(WebAppSettingsAdapter) private readonly settingsAdapter: WebAppSettingsAdapter,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is GenericResource {
        return !!resource
            && typeof resource === 'object'
            && isGenericResource(resource as ConcreteAzureNode)
            && this.settingsAdapter.canHandle(resource as GenericResource);
    }

    /** @inheritdoc */
    public getChildren(resource?: ConcreteAzureNode): ConcreteAzureNode[] {
        return resource && isGenericResource(resource) ? getSettingsNodes(resource, this.settingsAdapter) : [];
    }
}
