/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FunctionAppLogicalType, getResourceGroupName, IWebAppClientProvider, parseAzureResourceId } from '@microsoft/vscode-azure-azutils';
import { ExternalError, ICodeContext, showSmartQuickPick, stringifyError } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import type { ManagedCommand } from '../ManagedCommand';
import { RevealResource } from '../tree/RevealResource';

/** Jumps to a user-assigned identity attached to a Function App without building an identity subtree. */
@injectable()
export class RevealFunctionAppIdentity implements ManagedCommand {
    /** Capability for apps reporting at least one user-assigned identity. */
    public static readonly ContextValue = 'revealFunctionAppIdentity';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
        @inject(IWebAppClientProvider) private readonly createClient: IWebAppClientProvider,
        @inject(RevealResource) private readonly reveal: RevealResource,
    ) { }

    /** Skips selection for a single identity and surfaces filtered or inaccessible reveal targets. */
    public async execute(key?: string): Promise<void> {
        const app = await this.selector.selectResource({ key, logicalTypes: [FunctionAppLogicalType] });
        const site = await this.createClient(app.subscription).webApps.get(getResourceGroupName(app.id), app.name);
        const ids = Object.keys(site.identity?.userAssignedIdentities ?? {});
        if (!ids.length) {
            throw new ExternalError(this.ctx.code.l10n.t('The Function App does not have a user-assigned identity.'));
        }
        let id = ids[0];
        if (ids.length > 1) {
            const items = ids.map(data => {
                const parsed = parseAzureResourceId(data);
                return { label: parsed.resourceName ?? data, description: parsed.resourceGroup, data };
            });
            const selected = await showSmartQuickPick(this.ctx, items, {
                title: this.ctx.code.l10n.t('Select an identity'),
            });
            id = selected.data;
        }
        try {
            await this.reveal.execute(app, id);
        } catch (error: unknown) {
            throw new ExternalError(this.ctx.code.l10n.t(
                'Could not reveal the identity. Its subscription may not be shown in the Resources view. {0}', stringifyError(error),
            ));
        }
    }
}
