/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, ICodeContext, IOutputChannel, stringifyError } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { OpenUrl } from '../../commands/OpenUrl';
import { IAzdService } from '../AzdService';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * After deployment, queries `azd show` for ingress URLs and shows a
 * toast notification offering to open the first one in a browser.
 *
 * Best-effort: silently skips when no URLs are available or when
 * `azd show` fails.
 */
@injectable()
export class ShowEndpointUrlStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(OpenUrl) private readonly openUrl: OpenUrl,
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

        // Deliberately not awaited: the notification stays up until the user acts
        // on it, which must not hold up the rest of the wizard.
        void this.promptToOpen(urls[0]);
    }

    private async promptToOpen(url: string): Promise<void> {
        const openAction = this.ctx.code.l10n.t('Open in Browser');
        const selection = await this.ctx.code.window.showInformationMessage(
            this.ctx.code.l10n.t('Application deployed: {0}', url),
            openAction,
        );

        if (selection !== openAction) {
            return;
        }

        try {
            // The URL comes from azd's output, so it is opened through OpenUrl
            // rather than openExternal directly, to pick up its scheme check.
            await this.openUrl.execute(url);
        } catch (error: unknown) {
            this.output.warn(this.ctx.code.l10n.t('Could not open the deployed endpoint: {0}', stringifyError(error)));
        }
    }
}
