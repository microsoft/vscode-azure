/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import {
    PickWorkspaceLocationStep,
    pickWorkspaceLocation,
    type PickWorkspaceLocationArgs,
    type WorkspaceLocation,
} from '../../src/wizard/PickWorkspaceLocationStep';
import { MockUri } from '../vscode/MockUri';
import { createMockCodeContext, respondToPrompts } from '../vscode/MockVsCode';

interface TestContext {
    readonly location?: WorkspaceLocation;
}

const strings = {
    title: 'Select the application location',
    placeHolder: 'Choose the application file',
};

async function createFile(code: typeof vscode, uri: vscode.Uri): Promise<void> {
    await code.workspace.fs.writeFile(uri, new Uint8Array());
}

function createMockWorkspace(): ReturnType<typeof createMockCodeContext> {
    const context = createMockCodeContext();
    context.mock.workspaceFolders.push({
        uri: context.ctx.code.Uri.from({ scheme: 'file', path: '/repo' }),
        name: 'repo',
        index: 0,
    });

    return context;
}

function createPicker(args: PickWorkspaceLocationArgs): {
    pick: () => Promise<WorkspaceLocation | undefined>;
    mock: ReturnType<typeof createMockCodeContext>['mock'];
} {
    const { ctx, mock } = createMockWorkspace();

    return { pick: () => pickWorkspaceLocation(ctx, args), mock };
}

describe('pickWorkspaceLocation (unit)', () => {
    it('fails before prompting when no workspace folder is open', async () => {
        const { ctx, mock } = createMockCodeContext();

        await expect(pickWorkspaceLocation(ctx, { kind: 'folder', strings, findFiles: ['package.json'] }))
            .to.be.rejectedWith('Open a workspace folder before selecting a location.');
        expect(mock.workspace.findFiles.mock.calls).to.have.length(0);
        expect(mock.quickPicks).to.have.length(0);
    });

    it('passes all findFiles arguments and returns a relative file path', async () => {
        const token: vscode.CancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: () => ({ dispose: () => undefined }),
        };
        const { pick, mock } = createPicker({
            kind: 'file',
            strings,
            findFiles: ['**/*.csproj', '**/obj/**', 12, token],
        });
        const file = mock.vscode.Uri.from({ scheme: 'file', path: '/repo/src/app.csproj' });
        await createFile(mock.vscode, file);
        const tracker = respondToPrompts(mock, [{ pick: 'src/app.csproj' }]);

        const location = await pick();

        expect(location?.uri.toString()).to.equal(file.toString());
        expect(location?.relativePath).to.equal('src/app.csproj');
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
        const { pick, mock } = createPicker({
            kind: 'folder',
            strings: {
                ...strings,
                placeHolder: 'Choose the application folder',
            },
            findFiles: ['*.json'],
        });
        await createFile(mock.vscode, mock.vscode.Uri.from({ scheme: 'file', path: '/repo/api/package.json' }));
        await createFile(mock.vscode, mock.vscode.Uri.from({ scheme: 'file', path: '/repo/api/host.json' }));
        const tracker = respondToPrompts(mock, [{ pick: 'api' }]);

        const location = await pick();

        expect(location?.relativePath).to.equal('api');
        expect(mock.quickPicks[0].items.map(item => item.label)).to.deep.equal([
            'api',
        ]);
        tracker.assertAllConsumed();
    });

    it('returns locations relative to a configured base', async () => {
        const { pick, mock } = createPicker({
            kind: 'folder',
            relativeTo: MockUri.file('/repo/apps/web'),
            suggestedRelativePaths: ['dist'],
            value: 'dist',
            strings: {
                ...strings,
                placeHolder: 'Choose the output folder',
            },
            findFiles: ['**/*'],
        });
        const tracker = respondToPrompts(mock, ['acceptDefault']);

        const location = await pick();

        expect(location?.relativePath).to.equal('dist');
        expect(location?.uri.path).to.equal('/repo/apps/web/dist');
        tracker.assertAllConsumed();
    });

    it('normalizes a root initial value to the displayed root label', async () => {
        const { pick, mock } = createPicker({
            kind: 'folder',
            relativeTo: MockUri.file('/repo'),
            suggestedRelativePaths: ['/'],
            value: '/',
            allowCustom: true,
            strings,
            findFiles: ['**/*'],
        });
        const tracker = respondToPrompts(mock, ['acceptDefault']);

        const location = await pick();

        expect(mock.quickPicks[0].value).to.equal('.');
        expect(location?.relativePath).to.equal('');
        tracker.assertAllConsumed();
    });

    it('preserves an empty initial value for an explicit none choice', async () => {
        const { pick, mock } = createPicker({
            kind: 'folder',
            relativeTo: MockUri.file('/repo'),
            suggestedRelativePaths: ['/'],
            value: '',
            allowCustom: true,
            noneLabel: 'No output',
            strings,
            findFiles: ['**/*'],
        });
        const tracker = respondToPrompts(mock, ['acceptDefault']);

        const location = await pick();

        expect(mock.quickPicks[0].value).to.equal('');
        expect(location).to.equal(undefined);
        tracker.assertAllConsumed();
    });

    it('accepts a custom location that stays inside the workspace', async () => {
        const { pick, mock } = createPicker({
            kind: 'folder',
            relativeTo: MockUri.file('/repo/apps/web'),
            allowCustom: true,
            strings: {
                ...strings,
                placeHolder: 'Choose the output folder',
            },
            findFiles: ['**/*'],
        });
        const tracker = respondToPrompts(mock, [{ value: '../shared' }]);

        const location = await pick();

        expect(location?.relativePath).to.equal('../shared');
        expect(location?.uri.path).to.equal('/repo/apps/shared');
        tracker.assertAllConsumed();
    });

    it('returns undefined for an explicit none choice', async () => {
        const { pick, mock } = createPicker({
            kind: 'folder',
            noneLabel: 'No output',
            strings,
            findFiles: ['**/*'],
        });
        const tracker = respondToPrompts(mock, [{ pick: 'No output' }]);

        expect(await pick()).to.equal(undefined);
        tracker.assertAllConsumed();
    });
});

describe('PickWorkspaceLocationStep (unit)', () => {
    it('stores the picked location on the configured context property', async () => {
        const { ctx, mock } = createMockWorkspace();
        const step = new PickWorkspaceLocationStep<TestContext>(ctx, ['*.json'], {
            kind: 'folder',
            strings,
            contextProperty: 'location',
        });
        await createFile(mock.vscode, mock.vscode.Uri.from({ scheme: 'file', path: '/repo/api/package.json' }));
        const tracker = respondToPrompts(mock, [{ pick: 'api' }]);

        const result = await step.prompt({});

        expect(result.location?.relativePath).to.equal('api');
        expect(mock.workspace.findFiles.mock.calls[0].arguments).to.deep.equal(['*.json']);
        tracker.assertAllConsumed();
    });
});
