/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupName, IFunctionsHostClientProvider, IWebAppClientProvider } from '@microsoft/vscode-azure-azutils';
import { ExternalError, ICodeContext, showMessage, showSmartInputBox, withDelayedProgress } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import { isFunctionAppFunction } from '../../tree/resources/webApp/FunctionApp';
import type { ManagedCommand } from '../ManagedCommand';

/** Submits a remote invocation to the host admin API without claiming execution has completed. */
@injectable()
export class ExecuteFunction implements ManagedCommand {
    /** Capability for readable remote function leaves. */
    public static readonly ContextValue = 'executeFunction';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
        @inject(IWebAppClientProvider) private readonly createClient: IWebAppClientProvider,
        @inject(IFunctionsHostClientProvider) private readonly createHost: IFunctionsHostClientProvider,
    ) { }

    /** Prompts for input without persisting payloads, then sends the master key only through the host client. */
    public async execute(key?: string): Promise<void> {
        const fn = await this.selector.selectVirtual({ key, canHandle: isFunctionAppFunction });
        const input = await showSmartInputBox(this.ctx, {
            title: this.ctx.code.l10n.t('Execute \'{0}\'', fn.functionName),
            prompt: this.ctx.code.l10n.t('Enter the function input. Leave empty for no input.'),
            rememberRecent: false,
        });
        const app = fn.azureResource;
        const client = this.createClient(app.subscription);
        const group = getResourceGroupName(app.id);
        const site = await client.webApps.get(group, app.name);
        if (!site.defaultHostName) {
            throw new ExternalError(this.ctx.code.l10n.t('The Function App does not report a host name.'));
        }
        const host = this.createHost({
            endpoint: `https://${site.defaultHostName}`,
            getMasterKey: async () => (await client.webApps.listHostKeys(group, app.name)).masterKey ?? '',
        });
        await withDelayedProgress(this.ctx.code, {
            location: this.ctx.code.ProgressLocation.Notification,
            title: this.ctx.code.l10n.t('Submitting invocation for \'{0}\'...', fn.functionName),
        }, host.invoke(fn.functionName, input));
        void showMessage(this.ctx.code, this.ctx.code.l10n.t('Invocation submitted for \'{0}\'.', fn.functionName));
    }
}
