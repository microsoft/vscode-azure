/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { Container } from 'inversify';
import { rejects } from 'node:assert';
import { mock } from 'node:test';
import * as vscode from 'vscode';
import { OpenUrl, type UrlProviderIdentifier } from '../../src/commands/OpenUrl';

describe('OpenUrl (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    /** Builds the command with an empty execution container, matching how commands are resolved at runtime. */
    function createCommand() {
        const mockResult = createMockVsCode({ Uri: vscode.Uri });
        return { command: new OpenUrl(mockResult.vscode, new Container()), mockResult };
    }

    it('opens a fixed URL', async () => {
        const { command, mockResult } = createCommand();

        await command.execute('https://example.com/docs');

        expect(mockResult.env.openExternal.mock.calls[0].arguments[0].toString())
            .to.equal('https://example.com/docs');
    });

    it('opens a URL derived from the command arguments', async () => {
        const { command, mockResult } = createCommand();
        const resolver = mock.fn((...args: unknown[]) => `https://example.com/${String(args[0])}`);

        await command.execute(resolver, 'selected-item');

        expect(resolver.mock.calls[0].arguments).to.deep.equal(['selected-item']);
        expect(mockResult.env.openExternal.mock.calls[0].arguments[0].toString())
            .to.equal('https://example.com/selected-item');
    });

    it('opens a URL from a provider resolved out of the execution container', async () => {
        // Mirrors `registerManagedCommand`: the provider is bound on the root
        // container while the command is resolved from a per-execution child.
        const identifier: UrlProviderIdentifier = Symbol.for('ITestUrlProvider');
        const getUrl = mock.fn((...args: unknown[]) => `https://example.com/${String(args[0])}`);
        const mockResult = createMockVsCode({ Uri: vscode.Uri });
        const root = new Container();
        root.bind(identifier).toConstantValue({ getUrl });
        const executionContainer = new Container({ parent: root, autobind: true });
        const command = new OpenUrl(mockResult.vscode, executionContainer);

        await command.execute(identifier, 'selected-item');

        expect(getUrl.mock.calls[0].arguments).to.deep.equal(['selected-item']);
        expect(mockResult.env.openExternal.mock.calls[0].arguments[0].toString())
            .to.equal('https://example.com/selected-item');
    });

    it('reports when a URL is unavailable', async () => {
        const { command, mockResult } = createCommand();

        await rejects(
            command.execute(() => undefined),
            { message: 'No URL is available for the selected item.' },
        );
        expect(mockResult.env.openExternal.mock.callCount()).to.equal(0);
    });
});
