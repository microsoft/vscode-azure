/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { ManagedCommand } from '../ManagedCommand';
import { staticWebAppsDocumentationUrl, staticWebAppsFunctionsDocumentationUrl } from './staticWebAppLinks';

/** Opens Azure Static Web Apps product documentation. */
@injectable()
export class ShowStaticWebAppsDocumentation implements ManagedCommand {
    public constructor(@inject(IVsCode) private readonly code: IVsCode) { }

    /** @inheritdoc */
    public async execute(): Promise<void> {
        await this.code.env.openExternal(this.code.Uri.parse(staticWebAppsDocumentationUrl));
    }
}

/** Opens Functions API guidance for Azure Static Web Apps. */
@injectable()
export class ShowFunctionsDocumentation implements ManagedCommand {
    /** Context value for the no-functions help node. */
    public static readonly ContextValue = 'showStaticWebAppFunctionsDocumentation';

    public constructor(@inject(IVsCode) private readonly code: IVsCode) { }

    /** @inheritdoc */
    public async execute(): Promise<void> {
        await this.code.env.openExternal(this.code.Uri.parse(staticWebAppsFunctionsDocumentationUrl));
    }
}
