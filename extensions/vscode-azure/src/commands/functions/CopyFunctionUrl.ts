/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupName, IWebAppClientProvider } from '@microsoft/vscode-azure-azutils';
import { CaselessSet, ExternalError, IVsCode, showMessage } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import { isFunctionAppFunction } from '../../tree/resources/webApp/FunctionApp';
import { parseFunctionMetadata, type FunctionMetadata } from '../../functions/functionMetadata';
import type { ManagedCommand } from '../ManagedCommand';
import { LocalFunctionTarget } from '../../functions/LocalFunctionTarget';
import type { LocalFunctionNode } from '../../tree/workspace/WorkspaceNode';

interface FunctionUrl {
    readonly functionName: string;
    readonly url: URL;
}

/** Copies a live HTTP invocation URL with the least-privileged key its access level requires. */
@injectable()
export class CopyFunctionUrl implements ManagedCommand {
    /** Capability for HTTP-triggered functions with an available invocation URL. */
    public static readonly ContextValue = 'copyFunctionUrl';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
        @inject(IWebAppClientProvider) private readonly createClient: IWebAppClientProvider,
        @inject(LocalFunctionTarget) private readonly local: LocalFunctionTarget,
    ) { }

    /** Keeps keys out of notifications and output; admin URLs require explicit confirmation. */
    public async execute(key?: string): Promise<void> {
        const local = this.local.resolve(key);
        const { url, functionName } = local ? await this.localUrl(local) : await this.remoteUrl(key);
        await this.code.env.clipboard.writeText(url.toString());
        void showMessage(this.code, this.code.l10n.t('Copied the URL for \'{0}\'.', functionName));
    }

    private async localUrl(local: LocalFunctionNode): Promise<FunctionUrl> {
        const { client, port } = this.local.host(local);
        const fn = (await client.listFunctions()).find(fn => fn.name === local.functionName);
        if (!fn) {
            throw new ExternalError(this.code.l10n.t('The running host does not report this function. Refresh the workspace view.'));
        }
        this.httpTrigger(fn.config);
        const rawUrl = fn.invoke_url_template;
        if (!rawUrl || !URL.canParse(rawUrl)) {
            throw new ExternalError(this.code.l10n.t('The running host does not report an HTTP invocation URL for this function.'));
        }
        const url = new URL(rawUrl);
        if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
            || Number(url.port || '80') !== port || url.username || url.password) {
            throw new ExternalError(this.code.l10n.t('The local function URL must belong to the registered loopback host.'));
        }
        return { url, functionName: local.functionName };
    }

    private async remoteUrl(key?: string): Promise<FunctionUrl> {
        const fn = await this.selector.selectVirtual({ key, canHandle: isFunctionAppFunction });
        if (fn.triggerKind.toLowerCase() !== 'httptrigger') {
            throw new ExternalError(this.code.l10n.t('Only HTTP-triggered functions have an invocation URL.'));
        }
        const app = fn.azureResource;
        const client = this.createClient(app.subscription);
        const group = getResourceGroupName(app.id);
        const metadata = await client.webApps.getFunction(group, app.name, fn.functionName);
        const trigger = this.httpTrigger(metadata.config);
        const authLevel = trigger.authLevel;
        const rawUrl = metadata.invokeUrlTemplate
            ?? (await client.webApps.listFunctionSecrets(group, app.name, fn.functionName)).triggerUrl;
        if (!rawUrl || !URL.canParse(rawUrl)) {
            throw new ExternalError(this.code.l10n.t('The function does not report an invocation URL.'));
        }
        const url = new URL(rawUrl);
        if (url.protocol !== 'https:' || url.username || url.password) {
            throw new ExternalError(this.code.l10n.t('The remote function URL must use HTTPS without embedded credentials.'));
        }
        const site = await client.webApps.get(group, app.name);
        const hostNames = new CaselessSet([...(site.hostNames ?? []), ...(site.enabledHostNames ?? []), ...(site.defaultHostName ? [site.defaultHostName] : [])]);
        if (!hostNames.has(url.hostname)) {
            throw new ExternalError(this.code.l10n.t('The function URL must use a host name reported by the selected Function App.'));
        }
        for (const parameter of [...url.searchParams.keys()]) {
            if (parameter.toLowerCase() === 'code') {
                url.searchParams.delete(parameter);
            }
        }
        if (authLevel !== 'anonymous') {
            let functionKey: string | undefined;
            if (authLevel === 'admin') {
                await showMessage(this.code, this.code.l10n.t(
                    'This URL includes the app-wide master key. Copy it only to a trusted destination.',
                ), { modal: true, severity: 'warning', stepName: 'confirmCopyFunctionMasterKey' }, this.code.l10n.t('Copy'));
                functionKey = (await client.webApps.listHostKeys(group, app.name)).masterKey;
            } else {
                const keys = (await client.webApps.listFunctionKeys(group, app.name, fn.functionName)).properties;
                functionKey = keys?.default || Object.values(keys ?? {}).find(value => !!value);
                if (!functionKey) {
                    const hostKeys = (await client.webApps.listHostKeys(group, app.name)).functionKeys;
                    functionKey = hostKeys?.default || Object.values(hostKeys ?? {}).find(value => !!value);
                }
            }
            if (!functionKey) {
                throw new ExternalError(this.code.l10n.t('No key is available for the function URL.'));
            }
            url.searchParams.set('code', functionKey);
        }
        return { url, functionName: fn.functionName };
    }

    private httpTrigger(config: unknown): FunctionMetadata {
        const metadata = parseFunctionMetadata(this.code, config);
        if (metadata.triggerKind.toLowerCase() !== 'httptrigger') {
            throw new ExternalError(this.code.l10n.t('The latest function metadata does not report an HTTP trigger.'));
        }
        return metadata;
    }
}
