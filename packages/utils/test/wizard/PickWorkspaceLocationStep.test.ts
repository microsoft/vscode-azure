/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import { expect } from 'chai';
import type * as vscode from 'vscode';
import {
    PickWorkspaceLocationStep,
    type PickWorkspaceLocationOptions,
    type WorkspaceLocation,
} from '../../src/wizard/PickWorkspaceLocationStep';
import { createMockCodeContext, respondToPrompts } from '../vscode/MockVsCode';

interface TestContext {
    readonly location?: WorkspaceLocation;
}

const strings = {
    title: 'Select the application location',
    placeHolder: 'Choose the application file',
    browseLabel: 'Browse for an application file...',
    openLabel: 'Select application file',
};

async function createFile(code: typeof vscode, uri: vscode.Uri): Promise<void> {
    await code.workspace.fs.writeFile(uri, new Uint8Array());
}

function createStep(
    options: Omit<PickWorkspaceLocationOptions<TestContext>, 'updateContext'>,
): { step: PickWorkspaceLocationStep<TestContext>; mock: ReturnType<typeof createMockCodeContext>['mock'] } {
    const { ctx, mock } = createMockCodeContext();
    mock.workspaceFolders.push({
        uri: ctx.code.Uri.file('C:\\repo'),
        name: 'repo',
        index: 0,
    });

    return {
        step: new PickWorkspaceLocationStep(ctx, {
            ...options,
            updateContext: location => ({ location }),
        }),
        mock,
    };
}

describe('PickWorkspaceLocationStep (unit)', () => {
    it('passes all findFiles arguments and returns a relative file path', async () => {
        const token: vscode.CancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: () => ({ dispose: () => undefined }),
        };
        const { step, mock } = createStep({
            kind: 'file',
            findFilesArgs: ['**/*.csproj', '**/obj/**', 12, token],
            strings,
        });
        const file = mock.vscode.Uri.file('C:\\repo\\src\\app.csproj');
        await createFile(mock.vscode, file);
        const tracker = respondToPrompts(mock, [{ pick: 'src/app.csproj' }]);

        const result = await step.prompt({});

        expect(result.location?.uri.toString()).to.equal(file.toString());
        expect(result.location?.relativePath).to.equal('src/app.csproj');
        expect(mock.workspace.findFiles.mock.calls).to.have.length(1);
        assert.deepEqual(mock.workspace.findFiles.mock.calls[0].arguments, [
            '**/*.csproj',
            '**/obj/**',
            12,
            token,
        ]);
        tracker.assertAllConsumed();
    });

    it('deduplicates containing folders found from matching files', async () => {
        const { step, mock } = createStep({
            kind: 'folder',
            findFilesArgs: ['package.json'],
            strings: {
                ...strings,
                placeHolder: 'Choose the application folder',
                browseLabel: 'Browse for an application folder...',
                openLabel: 'Select application folder',
            },
        });
        await createFile(mock.vscode, mock.vscode.Uri.file('C:\\repo\\api\\package.json'));
        await createFile(mock.vscode, mock.vscode.Uri.file('C:\\repo\\api\\nested\\package.json'));
        const tracker = respondToPrompts(mock, [{ pick: 'api' }]);

        const result = await step.prompt({});

        expect(result.location?.relativePath).to.equal('api');
        expect(mock.quickPicks[0].items.map(item => item.label)).to.deep.equal([
            'api',
            'api/nested',
            'Browse for an application folder...',
        ]);
        tracker.assertAllConsumed();
    });

    it('supports an optional location', async () => {
        const { step, mock } = createStep({
            kind: 'folder',
            findFilesArgs: ['package.json'],
            strings: { ...strings, skipLabel: 'Do not configure an application folder' },
            allowSkip: true,
        });
        const tracker = respondToPrompts(mock, [{ pick: 'Do not configure an application folder' }]);

        const result = await step.prompt({});

        expect(result).to.have.property('location', undefined);
        tracker.assertAllConsumed();
    });

    it('uses the configured browse dialog strings and selection kind', async () => {
        const { step, mock } = createStep({
            kind: 'folder',
            findFilesArgs: ['package.json'],
            strings,
        });
        const folder = mock.vscode.Uri.file('C:\\repo\\web');
        mock.window.showOpenDialog.mock.mockImplementation(() => Promise.resolve([folder]));
        const tracker = respondToPrompts(mock, [{ pick: 'Browse for an application file...' }]);

        const result = await step.prompt({});

        expect(result.location?.relativePath).to.equal('web');
        expect(mock.window.showOpenDialog.mock.calls[0].arguments[0]).to.include({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select application file',
            title: 'Select the application location',
        });
        tracker.assertAllConsumed();
    });
});
