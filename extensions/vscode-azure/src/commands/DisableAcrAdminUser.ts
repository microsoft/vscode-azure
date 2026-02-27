/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import * as vscode from 'vscode';
import { IAzureResourceTreeCache } from '../services';
import type { EnrichedAcrRegistry } from '../tree/acr/AcrRegistry';
import { isAcrRegistry } from '../tree/acr/AcrRegistry';
import type { ManagedCommand } from './ManagedCommand';

// TODO: remove this demonstration command
@injectable()
export class DisableAcrAdminUser implements ManagedCommand {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzureResourceTreeCache) private readonly cache: IAzureResourceTreeCache,
    ) { }

    public async execute(key: string): Promise<void> {
        const resource = this.cache.get(key);
        if (!resource || !isAcrRegistry(resource)) {
            return;
        }

        const registry = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Loading details for '${resource.name}'...`,
            },
            () => this.cache.whenEnriched<EnrichedAcrRegistry>(resource),
        );

        void this.code.window.showInformationMessage(
            `If this command were real, it would disable admin user on '${registry.name}' (loginServer: ${registry.loginServer}, sku: ${registry.sku.name}).`
        );
    }
}
