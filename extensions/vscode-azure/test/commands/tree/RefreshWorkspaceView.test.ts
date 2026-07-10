/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Everything } from '@microsoft/vscode-azure-utils';
import { expect } from 'chai';
import { mock } from 'node:test';
import { RefreshWorkspaceView } from '../../../src/commands/tree/RefreshWorkspaceView';

describe('RefreshWorkspaceView (unit)', () => {
    it('invalidates everything on the workspace data tree', () => {
        const invalidate = mock.fn();
        const cache = { invalidate } as never;

        new RefreshWorkspaceView(cache).execute();

        expect(invalidate.mock.callCount()).to.equal(1);
        expect(invalidate.mock.calls[0].arguments[0]).to.equal(Everything);
    });
});
