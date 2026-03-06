/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { inject, injectable } from 'inversify';
import { IAzureViewViewItemTree } from '../services';
import type { ManagedCommand } from './ManagedCommand';

@injectable()
export class LoadMore implements ManagedCommand {
    public constructor(
        @inject(IAzureViewViewItemTree) private readonly viewItemTree: IAzureViewViewItemTree,
    ) { }

    public async execute(parentViewItem: string): Promise<void> {
        await this.viewItemTree.loadMore(parentViewItem);
    }
}
