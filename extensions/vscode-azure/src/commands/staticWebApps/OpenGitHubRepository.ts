/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IStaticWebAppsGitHubService } from '../../services/StaticWebAppsGitHubService';
import { StaticWebAppVirtualTypes, type StaticWebAppEnvironment } from '../../tree/resources/staticWebApps/StaticWebApp';
import type { ManagedCommand } from '../ManagedCommand';
import { isStaticWebAppEnvironment } from './BrowseStaticWebApp';
import { StaticWebAppCommandResolver } from './StaticWebAppCommandResolver';
import { encodeGitHubBranch, getGitHubRepositoryUrl } from './staticWebAppLinks';

/** Opens the linked GitHub repository at an environment's source branch. */
@injectable()
export class OpenGitHubRepository implements ManagedCommand {
    /** Context value for environment tree items. */
    public static readonly ContextValue = 'openStaticWebAppGitHubRepository';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(StaticWebAppCommandResolver) private readonly resolver: StaticWebAppCommandResolver,
        @inject(IStaticWebAppsGitHubService) private readonly github: IStaticWebAppsGitHubService,
    ) { }

    /** @inheritdoc */
    public async execute(key?: string): Promise<void> {
        const environment = key
            ? this.resolver.resolveVirtual<StaticWebAppEnvironment>(
                key,
                resource => resource.virtualType === StaticWebAppVirtualTypes.Environment && isStaticWebAppEnvironment(resource),
            )
            : undefined;
        const site = await this.resolver.whenSiteEnriched(
            environment?.azureResource ?? await this.resolver.resolveSite(),
        );
        const repository = this.github.parseRepositoryUrl(site.repositoryUrl);
        const branch = environment?.branch ?? site.branch;
        if (!repository || !branch) {
            throw new Error(this.code.l10n.t('The selected environment is not linked to a GitHub repository branch.'));
        }

        const url = `${getGitHubRepositoryUrl(repository)}/tree/${encodeGitHubBranch(branch)}`;
        await this.code.env.openExternal(this.code.Uri.parse(url));
    }
}
