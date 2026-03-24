/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { Mock } from 'node:test';
import * as vscode from 'vscode';
import { Hello } from '../../commands/Hello';

describe('Hello command', () => {
    it('(unit) should set telemetry property', async () => {
        const context = createActionContext('test');
        const { vscode: code } = createMockVsCode();

        const hello = new Hello(context, code);
        await hello.execute();

        expect(context.telemetry.properties.hello).to.equal('world');

        const showInfoMsg = code.window.showInformationMessage as unknown as Mock<typeof code.window.showInformationMessage>;
        expect(showInfoMsg.mock.callCount()).to.equal(1);
        expect(showInfoMsg.mock.calls[0]?.arguments[0]).to.equal('Hello, from the Azure extension!');
    });

    it('(integration) should execute without error', async () => {
        await vscode.commands.executeCommand('azure.hello');
    });
});
