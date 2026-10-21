/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Everything, EventEmitter } from '@microsoft/vscode-azure-utils';
import { mock } from 'node:test';
import { refreshWorkspaceTreeOnIndexChange } from '../../src/tree/registerTrees';

describe('refreshWorkspaceTreeOnIndexChange (unit)', () => {
    it('invalidates the whole workspace tree so project children are re-read after an index change', () => {
        const emitter = new EventEmitter<void>();
        const tree = { invalidate: mock.fn() };
        const subscription = refreshWorkspaceTreeOnIndexChange({ onDidChangeIndex: emitter.event }, tree);
        emitter.fire();
        expect(tree.invalidate.mock.calls.map(call => call.arguments[0] as unknown)).to.deep.equal([Everything]);
        subscription.dispose();
        emitter.fire();
        expect(tree.invalidate.mock.callCount()).to.equal(1);
        emitter.dispose();
    });
});
