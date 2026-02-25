/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ResourceTree } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureResourceTreeCache } from 'src/services';
import type { AzureResourceNode } from 'src/tree/GenericAzureDataProvider';
import type { ManagedCommand } from './ManagedCommand';

@injectable()
export class RefreshResourcesView implements ManagedCommand {
    public constructor(
        @inject(IAzureResourceTreeCache) private readonly cache: ResourceTree<AzureResourceNode>
    ) { }

    public execute(): void {
        this.cache.invalidateAll();
    }
}
