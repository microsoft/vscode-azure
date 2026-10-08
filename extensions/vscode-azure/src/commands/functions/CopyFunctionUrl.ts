/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupName, IWebAppClientProvider } from '@microsoft/vscode-azure-azutils';
import { ExternalError, IVsCode, showMessage } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import { isFunctionAppFunction, isFunctionTriggerBinding } from '../../tree/resources/webApp/FunctionApp';
import type { ManagedCommand } from '../ManagedCommand';

/** Copies a live HTTP invocation URL with the least-privileged key its access level requires. */
@injectable()
export class CopyFunctionUrl implements ManagedCommand {
    /** Capability for remote HTTP-triggered functions. */
    public static readonly ContextValue = 'copyFunctionUrl';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
        @inject(IWebAppClientProvider) private readonly createClient: IWebAppClientProvider,
    ) { }

    /** Keeps keys out of notifications and output; admin URLs require explicit confirmation. */
    public async execute(key?: string): Promise<void> {
        const fn = await this.selector.selectVirtual({ key, canHandle: isFunctionAppFunction });
        if (fn.triggerKind.toLowerCase() !== 'httptrigger') {
            throw new ExternalError(this.code.l10n.t('Only HTTP-triggered functions have an invocation URL.'));
        }
        const app = fn.azureResource;
        const client = this.createClient(app.subscription);
        const group = getResourceGroupName(app.id);
        const metadata = await client.webApps.getFunction(group, app.name, fn.functionName);
        const config: unknown = metadata.config;
        const bindings: unknown[] = config && typeof config === 'object' && 'bindings' in config && Array.isArray(config.bindings)
            ? config.bindings : [];
        const triggers = bindings.filter(isFunctionTriggerBinding);
        if (triggers.length !== 1 || triggers[0].type.toLowerCase() !== 'httptrigger') {
            throw new ExternalError(this.code.l10n.t('The latest function metadata does not report an HTTP trigger.'));
        }
        const authLevel = typeof triggers[0].authLevel === 'string' ? triggers[0].authLevel.toLowerCase() : undefined;
        const rawUrl = metadata.invokeUrlTemplate
            ?? (await client.webApps.listFunctionSecrets(group, app.name, fn.functionName)).triggerUrl;
        if (!rawUrl || !URL.canParse(rawUrl)) {
            throw new ExternalError(this.code.l10n.t('The function does not report an invocation URL.'));
        }
        const url = new URL(rawUrl);
        if (url.protocol !== 'https:' || url.username || url.password) {
            throw new ExternalError(this.code.l10n.t('The remote function URL must use HTTPS without embedded credentials.'));
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
        await this.code.env.clipboard.writeText(url.toString());
        void showMessage(this.code, this.code.l10n.t('Copied the URL for \'{0}\'.', fn.functionName));
    }
}
