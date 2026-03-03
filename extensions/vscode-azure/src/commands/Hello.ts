/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { ManagedCommand } from './ManagedCommand';

@injectable()
export class Hello implements ManagedCommand {
    public constructor(
        @inject(IActionContext) private readonly context: IActionContext,
        @inject(IVsCode) private readonly code: IVsCode
    ) { }

    public async execute(): Promise<void> {
        this.context.telemetry.properties.hello = 'world';
        void this.code.window.showInformationMessage(this.code.l10n.t('Hello, from the Azure extension!'));
        await Promise.resolve();
    }
}
