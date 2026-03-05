/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { ManagedCommand } from './ManagedCommand';

@injectable()
export class OpenInPortal implements ManagedCommand {
    public static ContextValue = 'openInPortal';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode
    ) { }

    public execute(key: string): void {
        const portalUrl = AzureNodeId.parse(key).toPortalUrl();

        if (portalUrl) {
            void this.code.env.openExternal(this.code.Uri.parse(portalUrl));
        }
    }
}
