/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode, showMessage, withDelayedProgress } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { EnrichedAcrRegistry } from '../../tree/resources/acr/AcrRegistry';
import { AcrResourceType, isAcrRegistry } from '../../tree/resources/acr/AcrRegistry';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import type { ManagedCommand } from '../ManagedCommand';

/* c8 ignore start */

/**
 * Demonstration command that would disable the ACR admin user on a
 * registry node. When invoked without a key (e.g., from the command
 * palette) it prompts for a registry via {@linkcode IResourceSelector}.
 *
 * Today it only displays an informational message instead of making
 * the actual ARM call.
 *
 * @remarks This is demonstration code; removal is tracked by
 * {@link https://github.com/microsoft/vscode-azure/issues/177}.
 */
@injectable()
export class DisableAcrAdminUser implements ManagedCommand {
    /** Context value gating this command's visibility in the tree view. */
    public static ContextValue = 'disableAcrAdminUser';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
    ) { }

    /** @inheritdoc */
    public async execute(key?: string): Promise<void> {
        const resource = await this.selector.selectResource(AcrResourceType, key);

        if (!isAcrRegistry(resource)) {
            return;
        }

        const registry = await withDelayedProgress(
            this.code,
            {
                location: this.code.ProgressLocation.Notification,
                title: this.code.l10n.t('Loading details for \'{0}\'...', resource.name),
            },
            this.selector.whenEnriched<EnrichedAcrRegistry>(resource),
        );

        void showMessage(
            this.code,
            this.code.l10n.t('If this command were real, it would disable admin user on \'{0}\' (loginServer: {1}, sku: {2}).', registry.name, registry.loginServer, registry.sku.name)
        );
    }
}
