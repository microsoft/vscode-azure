/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import type * as vscode from 'vscode';
import {
    type FindWorkspaceFilesOptions,
    PickWorkspaceLocationStep,
    type PickWorkspaceLocationOptions,
    type WorkspaceLocation,
} from '../../src/wizard/PickWorkspaceLocationStep';
import { CancellationError } from '../../src/vscode/CancellationError';
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
    findFilesOptions: FindWorkspaceFilesOptions,
    options: Omit<PickWorkspaceLocationOptions<TestContext>, 'contextProperty'>,
): { step: PickWorkspaceLocationStep<TestContext>; mock: ReturnType<typeof createMockCodeContext>['mock'] } {
    const { ctx, mock } = createMockCodeContext();
    mock.workspaceFolders.push({
        uri: ctx.code.Uri.from({ scheme: 'file', path: '/repo' }),
        name: 'repo',
        index: 0,
    });

    return {
        step: new PickWorkspaceLocationStep(ctx, findFilesOptions, { ...options, contextProperty: 'location' }),
        mock,
    };
}

describe('PickWorkspaceLocationStep (unit)', () => {
    it('fails before prompting when no workspace folder is open', async () => {
        const { ctx, mock } = createMockCodeContext();
        const step = new PickWorkspaceLocationStep<TestContext>(ctx, { include: 'package.json' }, {
            kind: 'folder',
            strings,
            contextProperty: 'location',
        });

        try {
            await step.prompt({});
            expect.fail('Expected an error');
        } catch (error) {
            expect(error).to.be.an('error').with.property(
                'message',
                'Open a workspace folder before selecting a location.',
            );
        }
        expect(mock.workspace.findFiles.mock.calls).to.have.length(0);
        expect(mock.quickPicks).to.have.length(0);
    });

    it('passes all findFiles arguments and returns a relative file path', async () => {
        const token: vscode.CancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: () => ({ dispose: () => undefined }),
        };
        const { step, mock } = createStep({
            include: '**/*.csproj',
            exclude: '**/obj/**',
            maxResults: 12,
            token,
        }, {
            kind: 'file',
            strings,
        });
        const file = mock.vscode.Uri.from({ scheme: 'file', path: '/repo/src/app.csproj' });
        await createFile(mock.vscode, file);
        const tracker = respondToPrompts(mock, [{ pick: 'src/app.csproj' }]);

        const result = await step.prompt({});

        expect(result.location?.uri.toString()).to.equal(file.toString());
        expect(result.location?.relativePath).to.equal('src/app.csproj');
        expect(mock.workspace.findFiles.mock.calls).to.have.length(1);
        expect(mock.workspace.findFiles.mock.calls[0].arguments).to.deep.equal([
            '**/*.csproj',
            '**/obj/**',
            12,
            token,
        ]);
        tracker.assertAllConsumed();
    });

    it('deduplicates containing folders found from matching files', async () => {
        const { step, mock } = createStep({ include: 'package.json' }, {
            kind: 'folder',
            strings: {
                ...strings,
                placeHolder: 'Choose the application folder',
                browseLabel: 'Browse for an application folder...',
                openLabel: 'Select application folder',
            },
        });
        await createFile(mock.vscode, mock.vscode.Uri.from({ scheme: 'file', path: '/repo/api/package.json' }));
        await createFile(mock.vscode, mock.vscode.Uri.from({ scheme: 'file', path: '/repo/api/nested/package.json' }));
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
        const { step, mock } = createStep({ include: 'package.json' }, {
            kind: 'folder',
            strings: { ...strings, skipLabel: 'Do not configure an application folder' },
            allowSkip: true,
        });
        const tracker = respondToPrompts(mock, [{ pick: 'Do not configure an application folder' }]);

        const result = await step.prompt({});

        expect(result).to.have.property('location', undefined);
        tracker.assertAllConsumed();
    });

    it('uses the configured browse dialog strings and selection kind', async () => {
        const { step, mock } = createStep({ include: 'package.json' }, {
            kind: 'folder',
            strings,
        });
        const folder = mock.vscode.Uri.from({ scheme: 'file', path: '/repo/web' });
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

    it('throws CancellationError when the browse dialog is dismissed', async () => {
        const { step, mock } = createStep({ include: 'package.json' }, {
            kind: 'folder',
            strings,
        });
        const tracker = respondToPrompts(mock, [{ pick: 'Browse for an application file...' }]);

        try {
            await step.prompt({});
            expect.fail('Expected CancellationError');
        } catch (error) {
            expect(CancellationError.test(error)).to.be.true;
        }
        tracker.assertAllConsumed();
    });
});
