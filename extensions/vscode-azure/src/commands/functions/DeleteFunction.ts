/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupName, IWebAppClientProvider } from '@microsoft/vscode-azure-azutils';
import { CaselessMap, ExternalError, IVsCode, showMessage } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { IGenericActivityDataProvider } from '../../tree/activity/GenericActivityDataProvider';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import { isFunctionAppFunction, isFunctionAppReadOnly } from '../../tree/resources/webApp/FunctionApp';
import { WebAppSettingsAdapter } from '../../settings/adapters/WebAppSettingsAdapter';
import type { ManagedCommand } from '../ManagedCommand';

/** Deletes a remote function after confirmation, tracking the ARM operation in the activity tree. */
@injectable()
export class DeleteFunction implements ManagedCommand {
    /** Capability for readable remote function leaves. */
    public static readonly ContextValue = 'deleteFunction';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
        @inject(IWebAppClientProvider) private readonly createClient: IWebAppClientProvider,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
        @inject(IGenericActivityDataProvider) private readonly activities: IGenericActivityDataProvider,
        @inject(WebAppSettingsAdapter) private readonly settings: WebAppSettingsAdapter,
    ) { }

    /** Removes the cached leaf only after Azure confirms deletion; failed operations retain it. */
    public async execute(key?: string): Promise<void> {
        const fn = await this.selector.selectVirtual({ key, canHandle: isFunctionAppFunction });
        await showMessage(this.code, this.code.l10n.t(
            'Delete function \'{0}\'? This cannot be undone.', fn.functionName,
        ), { modal: true, severity: 'warning', stepName: 'confirmFunctionDeletion' }, this.code.l10n.t('Delete'));
        const app = fn.azureResource;
        const client = this.createClient(app.subscription);
        const site = await client.webApps.get(getResourceGroupName(app.id), app.name);
        const { entries } = await this.settings.read(app);
        if (isFunctionAppReadOnly(site, new CaselessMap(entries.map(entry => [entry.key, entry.value])))) {
            throw new ExternalError(this.code.l10n.t('This Function App uses a read-only deployment. Remove the function from its source project and redeploy instead.'));
        }
        const activity = this.activities.trackActivity({ title: this.code.l10n.t('Delete function \'{0}\'', fn.functionName) });
        try {
            await client.webApps.deleteFunction(getResourceGroupName(app.id), app.name, fn.functionName);
            activity.update({ status: 'Completed' });
        } catch (error: unknown) {
            activity.update({ status: 'Failed', error });
            throw error;
        }
        this.tree.remove(fn);
    }
}
