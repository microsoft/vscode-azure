/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, type ICodeContext } from '@microsoft/vscode-azure-utils';
import type { IAzdService } from '../AzdService';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * After deployment, queries `azd show` for ingress URLs and shows a
 * toast notification offering to open the first one in a browser.
 *
 * Best-effort: silently skips when no URLs are available or when
 * `azd show` fails.
 */
export class ShowEndpointUrlStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        private readonly ctx: ICodeContext,
        private readonly azd: IAzdService,
    ) {
        super();
    }

    public override shouldExecute(context: Readonly<TContext>): boolean {
        return !!context.iacFolder;
    }

    public async execute(context: Readonly<TContext>): Promise<void> {
        const showResult = await this.azd.show(context.iacFolder!); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- guarded by shouldExecute
        if (!showResult?.services) {
            return;
        }

        const urls: string[] = [];
        for (const svc of Object.values(showResult.services)) {
            if (svc.ingressUrl) {
                urls.push(svc.ingressUrl);
            }
        }

        if (urls.length === 0) {
            return;
        }

        const url = urls[0];
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
