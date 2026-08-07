/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { inject, injectable } from 'inversify';
import type { ManagedCommand } from '../ManagedCommand';
import { ResourceDeletionService } from './ResourceDeletionService';

/** Deletes an ARM resource group through the shared deletion pipeline. */
@injectable()
export class DeleteResourceGroup implements ManagedCommand {
    /** Context value gating resource-group deletion in the tree view. */
    public static readonly ContextValue = 'deleteResourceGroup';

    public constructor(
        @inject(ResourceDeletionService) private readonly deletion: ResourceDeletionService,
    ) { }

    /** @inheritdoc */
    public execute(key?: string): Promise<void> {
        return this.deletion.delete(key, 'resourceGroup');
    }
}
