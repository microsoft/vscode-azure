/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Everything } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import type { ManagedCommand } from '../ManagedCommand';

/** Invalidates the entire Azure resource data cache, forcing a refresh on next access. */
@injectable()
export class RefreshResourcesView implements ManagedCommand {
    public constructor(
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree
    ) { }

    /** @inheritdoc */
    public execute(): void {
        this.cache.invalidate(Everything);
    }
}
