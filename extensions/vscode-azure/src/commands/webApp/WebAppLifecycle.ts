/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupName, IWebAppClientProvider } from '@microsoft/vscode-azure-azutils';
import { IVsCode, showMessage, withDelayedProgress } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import { isWebApp } from '../../tree/resources/webApp/WebApp';
import type { ManagedCommand } from '../ManagedCommand';

/** Shared start, stop, and restart operations for all App Service-family sites. */
@injectable()
export class WebAppLifecycle implements ManagedCommand {
    /** Capabilities supplied by site view providers according to the reported state. */
    public static readonly StartContextValue = 'startWebApp';
    public static readonly StopContextValue = 'stopWebApp';
    public static readonly RestartContextValue = 'restartWebApp';

    /** Offers lifecycle actions only when Azure has reported a stable running or stopped state. */
    public static contextValues(state?: string): string[] {
        switch (state?.toLowerCase()) {
            case 'running': return [this.StopContextValue, this.RestartContextValue];
            case 'stopped': return [this.StartContextValue];
            default: return [];
        }
    }

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
        @inject(IWebAppClientProvider) private readonly createClient: IWebAppClientProvider,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
    ) { }

    /** Executes the action supplied by command registration and refreshes only the selected site. */
    public async execute(action: 'start' | 'stop' | 'restart', key?: string): Promise<void> {
        const app = this.selector.resolve({ key, canHandle: isWebApp });
        const messages = {
            start: [this.code.l10n.t('Starting \'{0}\'...', app.name), this.code.l10n.t('Started \'{0}\'.', app.name)],
            stop: [this.code.l10n.t('Stopping \'{0}\'...', app.name), this.code.l10n.t('Stopped \'{0}\'.', app.name)],
            restart: [this.code.l10n.t('Restarting \'{0}\'...', app.name), this.code.l10n.t('Restarted \'{0}\'.', app.name)],
        }[action];
        const client = this.createClient(app.subscription);
        await withDelayedProgress(this.code, {
            location: this.code.ProgressLocation.Notification,
            title: messages[0],
        }, client.webApps[action](getResourceGroupName(app.id), app.name));
        this.tree.invalidate(app);
        void showMessage(this.code, messages[1]);
    }
}
