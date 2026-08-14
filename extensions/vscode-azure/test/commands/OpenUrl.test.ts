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

    it('refuses to open a URL that is not http(s)', async () => {
        // Uri.parse accepts every one of these, and VS Code only blocks the
        // `command:` scheme, so this check is the last line of defense.
        const blocked = [
            'javascript:alert(1)',
            'mailto:someone@contoso.example.com',
            'ftp://contoso.example.com',
            'file:///etc/passwd',
            'vscode:extension/some.extension',
            // Uri.parse silently reads a scheme-less value as a file path.
            'contoso.azurewebsites.net',
        ];

        for (const url of blocked) {
            const mockResult = createMockVsCode({ Uri: vscode.Uri });
            const command = new OpenUrl(mockResult.vscode);

            await rejects(command.execute(url), /Only http and https links can be opened/, `expected ${url} to be blocked`);
            expect(mockResult.env.openExternal.mock.callCount(), `expected ${url} not to be opened`).to.equal(0);
        }
    });

    it('opens http and https regardless of scheme casing', async () => {
        for (const url of ['http://contoso.example.com/', 'https://contoso.example.com/', 'HTTPS://contoso.example.com/']) {
            const mockResult = createMockVsCode({ Uri: vscode.Uri });
            const command = new OpenUrl(mockResult.vscode);

            await command.execute(url);

            expect(mockResult.env.openExternal.mock.callCount(), `expected ${url} to be opened`).to.equal(1);
        }
    });
});
