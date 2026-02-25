/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { inject, injectable } from 'inversify';
import { IAzureResourceTreeCache } from '../services';
import type { ManagedCommand } from './ManagedCommand';

@injectable()
export class RefreshResourcesView implements ManagedCommand {
    public constructor(
        @inject(IAzureResourceTreeCache) private readonly cache: IAzureResourceTreeCache
    ) { }

    public execute(): void {
        this.cache.invalidateAll();
    }
}
