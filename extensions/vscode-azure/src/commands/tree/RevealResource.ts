/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { inject, injectable } from 'inversify';
import { IAzureResourceTreeView } from '../../services';
import type { ManagedCommand } from '../ManagedCommand';

/** Reveals a related ARM resource using the reference resource's cloud, account, and tenant context. */
@injectable()
export class RevealResource implements ManagedCommand {
    /** Capability for callers that supply an ARM target and a reference resource. */
    public static readonly ContextValue = 'revealResource';

    public constructor(
        @inject(IAzureResourceTreeView) private readonly view: IAzureResourceTreeView,
    ) { }

    /** Related resources may live in another group or subscription; tree failures propagate to the caller. */
    public async execute(reference: GenericResource, resourceId: string): Promise<void> {
        const key = AzureNodeId.from(reference).forRelatedResource(resourceId).toString();
        await this.view.reveal(key, { select: true, focus: true });
    }
}
