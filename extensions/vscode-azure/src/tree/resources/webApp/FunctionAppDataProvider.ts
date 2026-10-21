/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getNodeType, getResourceGroupName, IWebAppClientProvider, type ConcreteAzureNode, type FunctionEnvelope } from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, IVsCode, stringifyError, type ChildResult, type DataProvider, type Page } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { parseFunctionMetadata } from '../../../functions/functionMetadata';
import { WebAppSettingsAdapter } from '../../../settings/adapters/WebAppSettingsAdapter';
import { getSettingsNodes } from '../settings/SettingsNode';
import { setWebsiteUrl } from '../websiteUrl';
import {
    FunctionAppVirtualTypes,
    isFunctionApp,
    isFunctionAppVirtualNode,
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
    /** Latest site read per app, started by the tree's background enrichment. */
    private readonly reads = new WeakMap<FunctionApp, Promise<boolean>>();
    private readonly settled = new WeakSet<FunctionApp>();

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
    public enrich(resource: ConcreteAzureNode): Promise<boolean> {
        if (!isFunctionApp(resource)) {
            return Promise.resolve(false);
        }

        this.settled.delete(resource);
        const read = this.readSite(resource).finally(() => { this.settled.add(resource); });
        this.reads.set(resource, read);
        return read;
    }

    private async readSite(resource: FunctionApp): Promise<boolean> {
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
            // Expansion waits for the tree's enrichment read; a failed read is retried on expansion.
            const existing = this.reads.get(resource);
            const retry = existing === undefined || (this.settled.has(resource) && resource.siteError !== undefined);
            await (retry ? this.enrich(resource) : existing);
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
            const metadata = parseFunctionMetadata(this.code, data.config);
            return {
                virtualType: FunctionAppVirtualTypes.Function,
                virtualPath: `functions/${encodeURIComponent(functionName)}`,
                azureResource: app,
                data,
                functionName,
                ...metadata,
                isDisabled: data.isDisabled ?? metadata.isDisabled,
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
