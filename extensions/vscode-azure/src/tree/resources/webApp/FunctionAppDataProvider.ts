/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getNodeType, getResourceGroupName, IWebAppClientProvider, type ConcreteAzureNode, type FunctionEnvelope } from '@microsoft/vscode-azure-azutils';
import { CaselessMap, IActionExecutor, IVsCode, stringifyError, mapPages, type ChildResult, type DataProvider, type Page } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { parseFunctionMetadata } from '../../../functions/functionMetadata';
import { WebAppSettingsAdapter } from '../../../settings/adapters/WebAppSettingsAdapter';
import { getSettingsNodes } from '../settings/SettingsNode';
import { setWebsiteUrl } from '../websiteUrl';
import {
    FunctionAppVirtualTypes,
    isFunctionApp,
    isFunctionAppVirtualNode,
    isFunctionAppReadOnly,
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
    /** The tree waits for site enrichment before expanding an app, so children see the loaded site. */
    public readonly awaitEnrichment = true;

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
        return this.readSite(resource);
    }

    private async readSite(resource: FunctionApp): Promise<boolean> {
        this.executor.setTelProp('nodeType', getNodeType(resource));
        try {
            const client = this.createClient(resource.subscription);
            const site = await client.webApps.get(getResourceGroupName(resource.id), resource.name);
            resource.site = site;
            setWebsiteUrl(resource, site.defaultHostName);
            const wasInvalid = resource.siteError !== undefined;
            const previousReadOnly = resource.isReadOnly;
            resource.siteError = undefined;
            resource.isReadOnly = undefined;
            try {
                const { entries } = await this.settingsAdapter.read(resource);
                resource.isReadOnly = isFunctionAppReadOnly(site, new CaselessMap(entries.map(entry => [entry.key, entry.value])));
            } catch {
                this.executor.output.warn(this.code.l10n.t('[data] Could not determine whether functions in "{0}" are writable. Function deletion is unavailable.', resource.name));
            }
            return wasInvalid || previousReadOnly !== resource.isReadOnly;
        } catch (error: unknown) {
            resource.site = undefined;
            resource.isReadOnly = undefined;
            resource.siteError = stringifyError(error);
            setWebsiteUrl(resource, undefined);
            this.executor.output.error(this.code.l10n.t('[data] Could not read Function App "{0}": {1}', resource.name, resource.siteError));
            return true;
        }
    }

    /** @inheritdoc */
    public async getChildren(resource?: ConcreteAzureNode): Promise<ChildResult<ConcreteAzureNode>> {
        if (isFunctionApp(resource)) {
            if (resource.site === undefined) {
                await this.readSite(resource);
            }
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
        try {
            const client = this.createClient(app.subscription);
            yield* mapPages(
                client.webApps.listFunctions(getResourceGroupName(app.id), app.name),
                (data, index) => this.toFunction(app, data, index),
            );
        } catch (error: unknown) {
            this.executor.output.error(this.code.l10n.t('[data] Could not list functions for Function App "{0}": {1}', app.name, stringifyError(error)));
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
            this.executor.output.error(this.code.l10n.t('[data] Could not read function metadata for Function App "{0}": {1}', app.name, stringifyError(error)));
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
