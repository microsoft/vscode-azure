/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Everything } from '@microsoft/vscode-azure-utils';
import { mock } from 'node:test';
import { RefreshResourcesView } from '../../../src/commands/tree/RefreshResourcesView';

describe('RefreshResourcesView (unit)', () => {
    it('should invalidate everything on the data tree', () => {
        const invalidate = mock.fn();
        const cache = { invalidate } as never;

        const cmd = new RefreshResourcesView(cache);
        cmd.execute();

        expect(invalidate.mock.callCount()).to.equal(1);
        expect(invalidate.mock.calls[0].arguments[0]).to.equal(Everything);
    });
});
