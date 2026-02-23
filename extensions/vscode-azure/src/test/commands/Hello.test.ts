/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createActionContext } from '@microsoft/vscode-azure-utils';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import * as vscode from 'vscode';
import { Hello } from '../../commands/Hello';

describe('Hello command', () => {
    it('(unit) should set telemetry property', async () => {
        const context = createActionContext('test');

        const showInformationMessage = mock.fn(_ => undefined);
        const mockVsCode = {
            window: {
                showInformationMessage,
            },
        };

        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        const hello = new Hello(context, mockVsCode as any);
        await hello.execute();

        expect(context.telemetry.properties.hello).to.equal('world');
        expect(showInformationMessage.mock.callCount()).to.equal(1);
        expect(showInformationMessage.mock.calls[0]?.arguments[0]).to.equal('Hello, from the Azure extension!');
    });

    it('(integration) should execute without error', async () => {
        await vscode.commands.executeCommand('azure.hello');
    });
});
