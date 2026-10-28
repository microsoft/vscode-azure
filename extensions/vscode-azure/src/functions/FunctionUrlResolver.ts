/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupName, IWebAppClientProvider, type IWebAppClient } from '@microsoft/vscode-azure-azutils';
import { CaselessSet, ExternalError, IVsCode, showMessage, type ICaselessSetReader } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { FunctionAppFunction } from '../tree/resources/webApp/FunctionApp';
import type { LocalFunctionNode } from '../tree/workspace/WorkspaceNode';
import { parseFunctionMetadata, type FunctionMetadata } from './functionMetadata';
import { LocalFunctionTarget } from './LocalFunctionTarget';

/** A validated invocation URL and the function it invokes. */
export interface FunctionUrl {
    readonly functionName: string;
    readonly url: URL;
}

const LoopbackHosts = new CaselessSet(['localhost', '127.0.0.1', '[::1]']);

/**
 * Requires a URL on the registered loopback host and port, without embedded credentials.
 *
 * The owned host only serves plain HTTP but can report its invocation URLs with an `https:`
 * scheme, so either scheme is accepted and the result always uses `http:`.
 */
export function validateLocalFunctionUrl(code: IVsCode, rawUrl: string | null | undefined, port: number): URL {
    if (!rawUrl || !URL.canParse(rawUrl)) {
        throw new ExternalError(code.l10n.t('The running host does not report an HTTP invocation URL for this function.'));
    }
    const url = new URL(rawUrl);
    const defaultPort = url.protocol === 'https:' ? 443 : 80;
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !LoopbackHosts.has(url.hostname)
        || Number(url.port || defaultPort) !== port || url.username || url.password) {
        throw new ExternalError(code.l10n.t('The local function URL must belong to the registered loopback host.'));
    }
    url.protocol = 'http:';
    return url;
}

/**
 * Requires an https URL on one of the app's host names, without embedded credentials,
 * and removes any `code` query parameter so a key never comes from the service's template.
 */
export function validateRemoteFunctionUrl(code: IVsCode, rawUrl: string | null | undefined, hostNames: ICaselessSetReader): URL {
    if (!rawUrl || !URL.canParse(rawUrl)) {
        throw new ExternalError(code.l10n.t('The function does not report an invocation URL.'));
    }
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password) {
        throw new ExternalError(code.l10n.t('The remote function URL must use HTTPS without embedded credentials.'));
    }
    if (!hostNames.has(url.hostname)) {
        throw new ExternalError(code.l10n.t('The function URL must use a host name reported by the selected Function App.'));
    }
    for (const parameter of [...url.searchParams.keys()]) {
        if (parameter.toLowerCase() === 'code') {
            url.searchParams.delete(parameter);
        }
    }
    return url;
}

function firstKey(keys: Readonly<Record<string, string | undefined>> | undefined): string | undefined {
    return keys?.default || Object.values(keys ?? {}).find(value => !!value);
}

/**
 * Fetches the least-privileged key an access level requires: no key for anonymous,
 * the app-wide master key only for admin (after `confirmMasterKey`), otherwise a
 * function key with a host function key as the fallback.
 */
export async function selectFunctionKey(
    webApps: IWebAppClient['webApps'],
    group: string,
    appName: string,
    functionName: string,
    authLevel: string | undefined,
    confirmMasterKey: () => Promise<void>,
): Promise<string | undefined> {
    if (authLevel === 'anonymous') {
        return undefined;
    }
    if (authLevel === 'admin') {
        await confirmMasterKey();
        return (await webApps.listHostKeys(group, appName)).masterKey;
    }
    return firstKey((await webApps.listFunctionKeys(group, appName, functionName)).properties)
        ?? firstKey((await webApps.listHostKeys(group, appName)).functionKeys);
}

/**
 * Resolves invocation URLs for local and remote HTTP-triggered functions. Both paths
 * read fresh function metadata instead of trusting a cached tree node, and validate the
 * reported URL before any key is attached.
 */
@injectable()
export class FunctionUrlResolver {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IWebAppClientProvider) private readonly createClient: IWebAppClientProvider,
        @inject(LocalFunctionTarget) private readonly local: LocalFunctionTarget,
    ) { }

    /** Resolves a function served by a running local host. */
    public async resolveLocal(node: LocalFunctionNode): Promise<FunctionUrl> {
        const { client, port } = this.local.host(node);
        const fn = (await client.listFunctions()).find(fn => fn.name === node.functionName);
        if (!fn) {
            throw new ExternalError(this.code.l10n.t('The running host does not report this function. Refresh the workspace view.'));
        }
        this.httpTrigger(fn.config);
        return { url: validateLocalFunctionUrl(this.code, fn.invoke_url_template, port), functionName: node.functionName };
    }

    /**
     * Resolves a deployed function, appending a key when its access level requires one.
     *
     * The metadata and site reads are independent, so they run together. When the listing already
     * reports an admin access level, the master-key confirmation is shown at once, alongside those
     * reads, instead of after them. The current metadata still decides the access level: a function
     * that turns out to need admin access is confirmed afterwards, and no key is read without consent.
     */
    public async resolveRemote(fn: FunctionAppFunction, action: 'copy' | 'invoke' = 'copy'): Promise<FunctionUrl> {
        const app = fn.azureResource;
        const client = this.createClient(app.subscription);
        const group = getResourceGroupName(app.id);
        const confirmMasterKey = async (): Promise<void> => {
            await showMessage(this.code, action === 'copy'
                ? this.code.l10n.t('This URL includes the app-wide master key. Copy it only to a trusted destination.')
                : this.code.l10n.t('Invoking this HTTP function requires the app-wide master key. Continue only if you trust this Function App.'),
            { modal: true, severity: 'warning', stepName: 'confirmFunctionMasterKey' },
            action === 'copy' ? this.code.l10n.t('Copy') : this.code.l10n.t('Execute'));
        };
        const earlyConfirmation = fn.authLevel === 'admin' ? confirmMasterKey() : undefined;

        const [metadata, site] = await Promise.all([
            client.webApps.getFunction(group, app.name, fn.functionName),
            client.webApps.get(group, app.name),
            earlyConfirmation,
        ]);
        const { authLevel } = this.httpTrigger(metadata.config);
        const rawUrl = metadata.invokeUrlTemplate
            ?? (await client.webApps.listFunctionSecrets(group, app.name, fn.functionName)).triggerUrl;
        const hostNames = new CaselessSet([...(site.hostNames ?? []), ...(site.enabledHostNames ?? []), ...(site.defaultHostName ? [site.defaultHostName] : [])]);
        const url = validateRemoteFunctionUrl(this.code, rawUrl, hostNames);
        const key = await selectFunctionKey(client.webApps, group, app.name, fn.functionName, authLevel, () => earlyConfirmation ?? confirmMasterKey());
        if (authLevel !== 'anonymous') {
            if (!key) {
                throw new ExternalError(this.code.l10n.t('No key is available for the function URL.'));
            }
            url.searchParams.set('code', key);
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
