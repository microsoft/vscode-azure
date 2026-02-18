/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { ManagedCommand } from './ManagedCommand';

@injectable()
export class Hello implements ManagedCommand {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode
    ) { }

    public async execute(_context: IActionContext): Promise<void> {
        await this.code.window.showInformationMessage('Hello, from the Azure extension!');
    }
}
