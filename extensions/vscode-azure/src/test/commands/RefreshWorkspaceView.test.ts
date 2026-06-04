/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { mock } from 'node:test';
import { RefreshWorkspaceView } from '../../commands/RefreshWorkspaceView';

describe('RefreshWorkspaceView (unit)', () => {
    it('calls invalidateAll on the workspace data tree', () => {
        const invalidateAll = mock.fn();
        const cache = { invalidateAll } as never;

        new RefreshWorkspaceView(cache).execute();

        expect(invalidateAll.mock.callCount()).to.equal(1);
    });
});
