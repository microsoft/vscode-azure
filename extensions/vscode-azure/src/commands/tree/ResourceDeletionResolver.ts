/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable, multiInject } from 'inversify';
import {
    IResourceDeletionProvider,
    type ResourceDeletionPlan,
    type ResourceDeletionProvider,
} from '../../registration/ResourceDeletionProvider';

/**
 * Combines matching product deletion contributions into one executable plan.
 *
 * Earlier providers override later providers, so generic providers should be
 * registered last.
 */
@injectable()
export class ResourceDeletionResolver {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @multiInject(IResourceDeletionProvider) private readonly providers: readonly ResourceDeletionProvider[],
    ) { }

    /**
     * Resolve a complete deletion plan for {@linkcode resource}.
     *
     * @throws if no provider handles the resource or the merged plan is incomplete.
     */
    public async resolve(resource: ConcreteAzureNode): Promise<ResourceDeletionPlan> {
        const matches = this.providers.filter(provider => provider.canHandle(resource));
        if (!matches.length) {
            throw new Error(this.code.l10n.t('The selected item does not support deletion.'));
        }

        const merged: Partial<ResourceDeletionPlan> = {};
        for (const provider of [...matches].reverse()) {
            Object.assign(merged, await provider.getPlan(resource));
        }

        if (
            typeof merged.resourceName !== 'string'
            || !merged.confirmation
            || typeof merged.delete !== 'function'
            || !merged.cacheTarget
            || typeof merged.successMessage !== 'string'
        ) {
            throw new Error(this.code.l10n.t('The deletion provider for the selected item returned an incomplete plan.'));
        }

        return {
            resourceName: merged.resourceName,
            confirmation: merged.confirmation,
            delete: merged.delete,
            cacheTarget: merged.cacheTarget,
            successMessage: merged.successMessage,
            azdTarget: merged.azdTarget,
            telemetryType: merged.telemetryType,
        };
    }
}
