/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { rejects } from 'node:assert';
import { mock } from 'node:test';
import * as vscode from 'vscode';
import { OpenUrl } from '../../src/commands/OpenUrl';

describe('OpenUrl (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('opens a fixed URL', async () => {
        const mockResult = createMockVsCode({ Uri: vscode.Uri });
        const command = new OpenUrl(mockResult.vscode);

        await command.execute('https://example.com/docs');

        expect(mockResult.env.openExternal.mock.calls[0].arguments[0].toString())
            .to.equal('https://example.com/docs');
    });

    it('opens a URL derived from the command arguments', async () => {
        const mockResult = createMockVsCode({ Uri: vscode.Uri });
        const command = new OpenUrl(mockResult.vscode);
        const resolver = mock.fn((...args: unknown[]) => `https://example.com/${String(args[0])}`);

        await command.execute(resolver, 'selected-item');

        expect(resolver.mock.calls[0].arguments).to.deep.equal(['selected-item']);
        expect(mockResult.env.openExternal.mock.calls[0].arguments[0].toString())
            .to.equal('https://example.com/selected-item');
    });

    it('reports when a URL is unavailable', async () => {
        const mockResult = createMockVsCode({ Uri: vscode.Uri });
        const command = new OpenUrl(mockResult.vscode);

        await rejects(
            command.execute(() => undefined),
            { message: 'No URL is available for the selected item.' },
        );
        expect(mockResult.env.openExternal.mock.callCount()).to.equal(0);
    });
});
