/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, type ICodeContext } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Shows a toast notification with the first endpoint URL discovered
 * during deployment, offering an "Open in Browser" action.
 *
 * Skips silently when no endpoint URLs are present on the context.
 */
export class ShowEndpointUrlStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public override shouldExecute(context: Readonly<TContext>): boolean {
        return !!context.endpointUrls?.length;
    }

    public execute(context: TContext): void {
        const url = context.endpointUrls![0]; // eslint-disable-line @typescript-eslint/no-non-null-assertion -- guarded by shouldExecute
        const openAction = this.ctx.code.l10n.t('Open in Browser');
        void this.ctx.code.window.showInformationMessage(
            this.ctx.code.l10n.t('Application deployed: {0}', url),
            openAction,
        ).then((selection) => {
            if (selection === openAction) {
                void this.ctx.code.env.openExternal(this.ctx.code.Uri.parse(url));
            }
        });
    }
}
