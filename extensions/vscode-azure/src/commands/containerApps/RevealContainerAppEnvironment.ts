/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerAppResourceType } from '@microsoft/vscode-azure-azutils';
import { IVsCode, stringifyError, withDelayedProgress } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { ContainerApp } from '../../tree/resources/containerApps/ContainerApp';
import { isContainerApp } from '../../tree/resources/containerApps/ContainerApp';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import type { ManagedCommand } from '../ManagedCommand';
import { RevealResource } from '../tree/RevealResource';

/**
 * Reveals the managed environment that hosts a container app.
 *
 * Container apps and environments are siblings in the tree, each rooted in its
 * own resource group, so this is the navigation across the reference that the
 * hierarchy deliberately does not express as containment. The environment may
 * live in a different resource group than the app.
 *
 * The target's ARM id comes from the app's `environmentId`, which is only
 * available after enrichment.
 */
@injectable()
export class RevealContainerAppEnvironment implements ManagedCommand {
    /** Context value gating this command's visibility in the tree view. */
    public static ContextValue = 'revealContainerAppEnvironment';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
        @inject(RevealResource) private readonly revealResource: RevealResource,
    ) { }

    /** @inheritdoc */
    public async execute(key?: string): Promise<void> {
        const resource = await this.selector.selectResource({ logicalType: ContainerAppResourceType, key });
        if (!isContainerApp(resource)) {
            return;
        }

        const app = await withDelayedProgress(
            this.code,
            {
                location: this.code.ProgressLocation.Notification,
                title: this.code.l10n.t('Loading details for \'{0}\'...', resource.name),
            },
            this.selector.whenEnriched<ContainerApp>(resource),
        );

        if (!app.environmentId) {
            throw new Error(this.code.l10n.t('Could not determine the environment hosting \'{0}\'.', app.name));
        }

        try {
            await this.revealResource.execute(app, app.environmentId);
        } catch (error) {
            throw new Error(this.code.l10n.t(
                'Could not reveal the environment hosting \'{0}\'. It may be in a subscription that is not shown in the Resources view. {1}',
                app.name,
                stringifyError(error),
            ), { cause: error });
        }
    }
}
