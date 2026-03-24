/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import { RefreshResourcesView } from '../../commands/RefreshResourcesView';

describe('RefreshResourcesView (unit)', () => {
    it('should call invalidateAll on the data tree', () => {
        const invalidateAll = mock.fn();
        const cache = { invalidateAll } as never;

        const cmd = new RefreshResourcesView(cache);
        cmd.execute();

        expect(invalidateAll.mock.callCount()).to.equal(1);
    });
});
