/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getNodeType, getResourceGroupName, IWebAppClientProvider, type ConcreteAzureNode, type FunctionEnvelope } from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, IVsCode, stringifyError, type ChildResult, type DataProvider, type Page } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { WebAppSettingsAdapter } from '../../../settings/adapters/WebAppSettingsAdapter';
import { getSettingsNodes } from '../settings/SettingsNode';
import { setWebsiteUrl } from '../websiteUrl';
import {
    FunctionAppVirtualTypes,
    hasFunctionBindings,
    isFunctionApp,
    isFunctionAppVirtualNode,
    isFunctionTriggerBinding,
    type FunctionApp,
    type FunctionAppFunction,
    type FunctionAppFunctions,
    type FunctionAppInvalidNode,
} from './FunctionApp';

/**
 * Owns Function App site enrichment, settings children, and paged remote functions,
 * preserving site and individual metadata failures as visible children.
 */
@injectable()
export class FunctionAppDataProvider implements DataProvider<ConcreteAzureNode> {
    public constructor(
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IWebAppClientProvider) private readonly createClient: IWebAppClientProvider,
        @inject(WebAppSettingsAdapter) private readonly settingsAdapter: WebAppSettingsAdapter,
        @inject(IVsCode) private readonly code: IVsCode,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is ConcreteAzureNode {
        return isFunctionApp(resource) || isFunctionAppVirtualNode(resource);
    }

    /** @inheritdoc */
    public async enrich(resource: ConcreteAzureNode): Promise<boolean> {
        if (!isFunctionApp(resource)) {
            return false;
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));
        try {
            const client = this.createClient(resource.subscription);
            const site = await client.webApps.get(getResourceGroupName(resource.id), resource.name);
            resource.site = site;
            setWebsiteUrl(resource, site.defaultHostName);
            const wasInvalid = resource.siteError !== undefined;
            resource.siteError = undefined;
            return wasInvalid;
        } catch (error: unknown) {
            resource.site = undefined;
            resource.siteError = stringifyError(error);
            setWebsiteUrl(resource, undefined);
            this.executor.output.error(this.code.l10n.t('[data] Could not read Function App "{0}".', resource.name));
            return true;
        }
    }

    /** @inheritdoc */
    public async getChildren(resource?: ConcreteAzureNode): Promise<ChildResult<ConcreteAzureNode>> {
        if (isFunctionApp(resource)) {
            await this.enrich(resource);
            if (resource.siteError !== undefined) {
                return [this.invalidNode(resource, 'app', 'invalid', resource.siteError)];
            }
            const functions: FunctionAppFunctions = {
                virtualType: FunctionAppVirtualTypes.Functions,
                virtualPath: 'functions',
                azureResource: resource,
            };
            return [...getSettingsNodes(resource, this.settingsAdapter), functions];
        }
        if (isFunctionAppVirtualNode(resource) && resource.virtualType === FunctionAppVirtualTypes.Functions) {
            return this.listFunctions(resource);
        }
        return [];
    }

    private async *listFunctions(group: FunctionAppFunctions): AsyncIterable<Page<ConcreteAzureNode>> {
        const app = group.azureResource;
        this.executor.setTelProp('nodeType', getNodeType(group));
        let index = 0;
        try {
            const client = this.createClient(app.subscription);
            for await (const page of client.webApps.listFunctions(getResourceGroupName(app.id), app.name)) {
                yield {
                    items: page.items.map(data => this.toFunction(app, data, index++)),
                    hasMore: page.hasMore,
                };
            }
        } catch (error: unknown) {
            this.executor.output.error(this.code.l10n.t('[data] Could not list functions for Function App "{0}".', app.name));
            yield {
                items: [this.invalidNode(app, 'functions', 'functions/invalid', stringifyError(error))],
                hasMore: false,
            };
        }
    }

    private toFunction(app: FunctionApp, data: FunctionEnvelope, index: number): FunctionAppFunction | FunctionAppInvalidNode {
        const functionName = typeof data.name === 'string' ? data.name.split('/').at(-1) : undefined;
        try {
            if (!functionName?.trim()) {
                throw new Error(this.code.l10n.t('The function metadata does not include a name.'));
            }
            const config: unknown = data.config;
            if (!hasFunctionBindings(config)) {
                throw new Error(this.code.l10n.t('The function metadata does not include a bindings array.'));
            }
            const triggers = config.bindings.filter(isFunctionTriggerBinding);
            if (triggers.length !== 1 || !triggers[0]) {
                throw new Error(this.code.l10n.t('The function metadata must include exactly one trigger binding.'));
            }
            const trigger = triggers[0];
            const isHttp = trigger.type.toLowerCase() === 'httptrigger';
            return {
                virtualType: FunctionAppVirtualTypes.Function,
                virtualPath: `functions/${encodeURIComponent(functionName)}`,
                azureResource: app,
                data,
                functionName,
                triggerKind: trigger.type,
                isDisabled: data.isDisabled ?? ('disabled' in config && config.disabled === true),
                authLevel: isHttp && typeof trigger.authLevel === 'string' ? trigger.authLevel.toLowerCase() : undefined,
            };
        } catch (error: unknown) {
            this.executor.output.error(this.code.l10n.t('[data] Could not read function metadata for Function App "{0}".', app.name));
            return this.invalidNode(app, 'function', `functions/invalid/${index}`, stringifyError(error), functionName);
        }
    }

    private invalidNode(
        app: FunctionApp,
        kind: FunctionAppInvalidNode['kind'],
        virtualPath: string,
        error: string,
        sourceLabel?: string,
    ): FunctionAppInvalidNode {
        return { virtualType: FunctionAppVirtualTypes.Invalid, virtualPath, azureResource: app, kind, error, sourceLabel };
    }
}
