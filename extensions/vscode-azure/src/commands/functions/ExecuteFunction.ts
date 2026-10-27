/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupName, IFunctionsHostClientProvider, IWebAppClientProvider } from '@microsoft/vscode-azure-azutils';
import { ExternalError, ICodeContext, showMessage, showSmartInputBox, withDelayedProgress } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import { isFunctionAppFunction } from '../../tree/resources/webApp/FunctionApp';
import { LocalFunctionTarget } from '../../functions/LocalFunctionTarget';
import { FunctionUrlResolver } from '../../functions/FunctionUrlResolver';
import type { ManagedCommand } from '../ManagedCommand';

/** Submits an invocation to a local or remote host without claiming execution has completed. */
@injectable()
export class ExecuteFunction implements ManagedCommand {
    /** Capability for readable functions whose host can accept an invocation. */
    public static readonly ContextValue = 'executeFunction';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
        @inject(IWebAppClientProvider) private readonly createClient: IWebAppClientProvider,
        @inject(IFunctionsHostClientProvider) private readonly createHost: IFunctionsHostClientProvider,
        @inject(LocalFunctionTarget) private readonly local: LocalFunctionTarget,
        @inject(FunctionUrlResolver) private readonly urls: FunctionUrlResolver,
    ) { }

    /** Prompts for input without persisting payloads, then sends the master key only through the host client. */
    public async execute(key?: string): Promise<void> {
        const local = this.local.resolve(key);
        if (local) {
            this.local.host(local);
            const input = await this.prompt(local.functionName);
            // Trust and host readiness can change while the input prompt is open.
            const { client } = this.local.host(local);
            if (local.triggerKind.toLowerCase() === 'httptrigger') {
                const { url } = await this.urls.resolveLocal(local);
                const current = this.local.host(local);
                await this.invoke(local.functionName, current.client.invokeHttp(url, input), true);
            } else {
                await this.invoke(local.functionName, client.invoke(local.functionName, input));
            }
            return;
        }
        const fn = await this.selector.selectVirtual({ key, canHandle: isFunctionAppFunction });
        const input = await this.prompt(fn.functionName);
        const app = fn.azureResource;
        const client = this.createClient(app.subscription);
        const group = getResourceGroupName(app.id);
        if (fn.triggerKind.toLowerCase() === 'httptrigger') {
            const { url } = await this.urls.resolveRemote(fn, 'invoke');
            const host = this.createHost({
                endpoint: url.origin,
                getMasterKey: async () => (await client.webApps.listHostKeys(group, app.name)).masterKey ?? '',
            });
            await this.invoke(fn.functionName, host.invokeHttp(url, input), true);
            return;
        }
        const site = await client.webApps.get(group, app.name);
        if (!site.defaultHostName) {
            throw new ExternalError(this.ctx.code.l10n.t('The Function App does not report a host name.'));
        }
        const host = this.createHost({
            endpoint: `https://${site.defaultHostName}`,
            getMasterKey: async () => (await client.webApps.listHostKeys(group, app.name)).masterKey ?? '',
        });
        await this.invoke(fn.functionName, host.invoke(fn.functionName, input));
    }

    private prompt(name: string): Promise<string> {
        return showSmartInputBox(this.ctx, {
            title: this.ctx.code.l10n.t('Execute \'{0}\'', name),
            prompt: this.ctx.code.l10n.t('Enter the function input. Leave empty for no input.'),
            rememberRecent: false,
        });
    }

    private async invoke(name: string, operation: Promise<void>, http = false): Promise<void> {
        await withDelayedProgress(this.ctx.code, {
            location: this.ctx.code.ProgressLocation.Notification,
            title: this.ctx.code.l10n.t('Submitting invocation for \'{0}\'...', name),
        }, operation);
        void showMessage(this.ctx.code, http
            ? this.ctx.code.l10n.t('HTTP request completed for \'{0}\'.', name)
            : this.ctx.code.l10n.t('Invocation submitted for \'{0}\'.', name));
    }
}
