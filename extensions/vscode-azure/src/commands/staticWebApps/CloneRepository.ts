/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { ManagedCommand } from '../ManagedCommand';
import { StaticWebAppCommandResolver } from './StaticWebAppCommandResolver';

/** Starts VS Code's Git clone flow for a source-linked Static Web App. */
@injectable()
export class CloneRepository implements ManagedCommand {
    /** Context value for source-linked Static Web App roots. */
    public static readonly ContextValue = 'cloneStaticWebAppRepository';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(StaticWebAppCommandResolver) private readonly resolver: StaticWebAppCommandResolver,
    ) { }

    /** @inheritdoc */
    public async execute(key?: string): Promise<void> {
        const site = await this.resolver.whenSiteEnriched(await this.resolver.resolveSite(key));
        if (!site.repositoryUrl) {
            throw new Error(this.code.l10n.t('The selected Static Web App is not linked to a GitHub repository.'));
        }
        await this.code.commands.executeCommand('git.clone', site.repositoryUrl);
    }
}
