/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, fileExists, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { SwaCliConfigFileName } from '../../../staticWebApps/SwaCliConfig';
import type { CreateStaticWebAppContext } from '../CreateStaticWebAppContext';

/**
 * Materializes the SWA CLI configuration selected during project detection.
 *
 * Writing happens after confirmation so cancelling the wizard leaves the
 * workspace untouched. Existing configurations are never replaced.
 */
@injectable()
export class WriteStaticWebAppCliConfigStep extends ExecuteStep<CreateStaticWebAppContext> {
    public constructor(@inject(IVsCode) private readonly code: IVsCode) {
        super();
    }

    /** @inheritdoc */
    public override shouldExecute(context: Readonly<CreateStaticWebAppContext>): boolean {
        return context.job === 'deploy'
            && context.deploy === true
            && context.swaCliConfigNeedsWrite === true
            && !!context.swaCliConfig
            && !!context.iacFolder;
    }

    /** @inheritdoc */
    public async execute(context: Readonly<CreateStaticWebAppContext>): Promise<void> {
        const { iacFolder, swaCliConfig } = context;
        if (!iacFolder || !swaCliConfig) {
            return;
        }

        const configUri = this.code.Uri.joinPath(iacFolder, SwaCliConfigFileName);
        if (await fileExists(this.code, configUri)) {
            throw new Error(this.code.l10n.t(
                "The Static Web Apps CLI configuration '{0}' was created while this command was running. Run the command again to use it without replacing it.",
                configUri.fsPath,
            ));
        }

        const contents = `${JSON.stringify(swaCliConfig, undefined, 4)}\n`;
        await this.code.workspace.fs.writeFile(configUri, new TextEncoder().encode(contents));
    }
}
