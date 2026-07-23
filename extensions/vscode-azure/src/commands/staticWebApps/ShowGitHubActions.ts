/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IStaticWebAppsGitHubService } from '../../services/StaticWebAppsGitHubService';
import { StaticWebAppVirtualTypes, type StaticWebAppActions } from '../../tree/resources/staticWebApps/StaticWebApp';
import type { ManagedCommand } from '../ManagedCommand';
import { StaticWebAppCommandResolver } from './StaticWebAppCommandResolver';
import { getGitHubRepositoryUrl } from './staticWebAppLinks';

/** Opens a linked repository's GitHub Actions page. */
@injectable()
export class ShowGitHubActions implements ManagedCommand {
    /** Context value for Actions group tree items. */
    public static readonly ContextValue = 'showStaticWebAppGitHubActions';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(StaticWebAppCommandResolver) private readonly resolver: StaticWebAppCommandResolver,
        @inject(IStaticWebAppsGitHubService) private readonly github: IStaticWebAppsGitHubService,
    ) { }

    /** @inheritdoc */
    public async execute(key?: string): Promise<void> {
        const repository = key
            ? this.resolver.resolveVirtual<StaticWebAppActions>(
                key,
                resource => resource.virtualType === StaticWebAppVirtualTypes.Actions,
            ).repository
            : this.github.parseRepositoryUrl(
                (await this.resolver.whenSiteEnriched(await this.resolver.resolveSite())).repositoryUrl,
            );
        if (!repository) {
            throw new Error(this.code.l10n.t('The selected Static Web App is not linked to a GitHub repository.'));
        }
        await this.code.env.openExternal(this.code.Uri.parse(`${getGitHubRepositoryUrl(repository)}/actions`));
    }
}
