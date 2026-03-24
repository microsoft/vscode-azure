/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { Mock } from 'node:test';
import * as vscode from 'vscode';
import { OpenInPortal } from '../../commands/OpenInPortal';

describe('OpenInPortal (unit)', () => {
    it('should open the portal URL for a subscription node', () => {
        const { vscode: code } = createMockVsCode({ Uri: vscode.Uri });

        const cmd = new OpenInPortal(code);
        cmd.execute('azr://user1@portal.azure.com/tenants/t1/subscriptions/sub-1');

        const openExternal = code.env.openExternal as unknown as Mock<typeof code.env.openExternal>;
        expect(openExternal.mock.callCount()).to.equal(1);
    });

    it('should open the portal URL for a resource node', () => {
        const { vscode: code } = createMockVsCode({ Uri: vscode.Uri });

        const cmd = new OpenInPortal(code);
        cmd.execute('azr://user1@portal.azure.com/tenants/t1/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Web/sites/site1');

        const openExternal = code.env.openExternal as unknown as Mock<typeof code.env.openExternal>;
        expect(openExternal.mock.callCount()).to.equal(1);
    });
});
