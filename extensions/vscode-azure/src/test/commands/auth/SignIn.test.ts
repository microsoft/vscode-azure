/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockDataItemTree } from '@microsoft/vscode-azure-azutils/testing';
import { Roots } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import { SignIn } from '../../../commands/auth/SignIn';

describe('SignIn (unit)', () => {
    it('should trigger an interactive sign-in and invalidate the resources tree', async () => {
        const { ctx, mock: mockResult } = createMockCodeContext();
        const cache = createMockDataItemTree([]);
        const invalidate = (cache as unknown as { invalidate: ReturnType<typeof mock.fn> }).invalidate;
        const command = new SignIn(ctx, cache);

        await command.execute();

        const getSession = mockResult.authentication.getSession.mock;
        expect(getSession.callCount()).to.equal(1);
        // createIfNone forces interactive sign-in.
        const [, , options] = getSession.calls[0].arguments as [string, string[], { createIfNone?: boolean }];
        expect(options.createIfNone).to.be.true;

        expect(invalidate.mock.callCount()).to.equal(1);
        expect(invalidate.mock.calls[0].arguments[0]).to.equal(Roots);
    });
});
