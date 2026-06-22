/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Everything } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IWorkspaceViewDataTree } from '../services';
import type { ManagedCommand } from './ManagedCommand';

/** Invalidates the entire workspace data cache, forcing a refresh on next access. */
@injectable()
export class RefreshWorkspaceView implements ManagedCommand {
    public constructor(
        @inject(IWorkspaceViewDataTree) private readonly cache: IWorkspaceViewDataTree
    ) { }

    /** @inheritdoc */
    public execute(): void {
        this.cache.invalidate(Everything);
    }
}
