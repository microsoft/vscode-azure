/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode, withDelayedProgress } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { WebAppSettingsAdapter } from '../../settings/adapters/WebAppSettingsAdapter';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import { isFunctionAppFunction } from '../../tree/resources/webApp/FunctionApp';
import type { ManagedCommand } from '../ManagedCommand';

/** Enables or disables a remote function through its app's shared settings adapter. */
@injectable()
export class SetFunctionState implements ManagedCommand {
    /** Capabilities selected according to the function's reported disabled state. */
    public static readonly EnableContextValue = 'enableFunction';
    public static readonly DisableContextValue = 'disableFunction';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
        @inject(WebAppSettingsAdapter) private readonly settings: WebAppSettingsAdapter,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
    ) { }

    /** Read-modify-writes only the disable flag while preserving every other setting. */
    public async execute(disabled: boolean, key?: string): Promise<void> {
        const fn = await this.selector.selectVirtual({ key, canHandle: isFunctionAppFunction });
        const settingName = `AzureWebJobs.${fn.functionName}.Disabled`;
        const snapshot = await this.settings.read(fn.azureResource);
        const entries = snapshot.entries.filter(entry => entry.key !== settingName);
        entries.push({ key: settingName, value: String(disabled) });
        await withDelayedProgress(this.code, {
            location: this.code.ProgressLocation.Notification,
            title: disabled
                ? this.code.l10n.t('Disabling \'{0}\'...', fn.functionName)
                : this.code.l10n.t('Enabling \'{0}\'...', fn.functionName),
        }, this.settings.write(fn.azureResource, entries));
        this.tree.invalidate(fn.azureResource);
    }
}
