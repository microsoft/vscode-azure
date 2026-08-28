/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import {
    NoWorkspaceLocationError,
    PickWorkspaceLocationStep,
    type PickWorkspaceLocationOptions,
    type WorkspaceLocation,
} from '../../src/wizard/PickWorkspaceLocationStep';
import { MockUri } from '../vscode/MockUri';
import { createMockCodeContext, respondToPrompts } from '../vscode/MockVsCode';

interface TestContext {
    readonly appFolder?: string;
    readonly location?: WorkspaceLocation;
    readonly relativePath?: string;
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

function createStep(
    options: Omit<PickWorkspaceLocationOptions<TestContext>, 'contextProperty' | 'toContext'>,
): { step: PickWorkspaceLocationStep<TestContext>; mock: ReturnType<typeof createMockCodeContext>['mock'] } {
    const { ctx, mock } = createMockWorkspace();

    return {
        step: new PickWorkspaceLocationStep(ctx, { ...options, contextProperty: 'location' }),
        mock,
    };
}

describe('PickWorkspaceLocationStep (unit)', () => {
    it('fails before prompting when no workspace folder is open', async () => {
        const { ctx, mock } = createMockCodeContext();
        const step = new PickWorkspaceLocationStep<TestContext>(ctx, {
            kind: 'folder',
            strings,
            contextProperty: 'location',
            findFiles: ['package.json'],
        });

        await expect(step.prompt({})).to.be.rejectedWith(
            NoWorkspaceLocationError,
            'Open a workspace folder before selecting a location.',
        );
        expect(mock.workspace.findFiles.mock.calls).to.have.length(0);
        expect(mock.quickPicks).to.have.length(0);
    });

    it('passes all findFiles arguments and returns a relative file path', async () => {
        const token: vscode.CancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: () => ({ dispose: () => undefined }),
        };
        const { step, mock } = createStep({
            kind: 'file',
            strings,
            findFiles: ['**/*.csproj', '**/obj/**', 12, token],
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
        const { step, mock } = createStep({
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

        const result = await step.prompt({});

        expect(result.location?.relativePath).to.equal('api');
        expect(mock.quickPicks[0].items.map(item => item.label)).to.deep.equal([
            'api',
        ]);
        tracker.assertAllConsumed();
    });

    it('returns locations relative to a configured base', async () => {
        const { step, mock } = createStep({
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

        const result = await step.prompt({});

        expect(result.location?.relativePath).to.equal('dist');
        expect(result.location?.uri.path).to.equal('/repo/apps/web/dist');
        tracker.assertAllConsumed();
    });

    it('derives options from the context when the step runs', async () => {
        const { step, mock } = createStep({
            kind: 'folder',
            strings,
            findFiles: context => Promise.resolve([`${context.appFolder}/**/*.json`]),
            relativeTo: context => Promise.resolve(MockUri.file(`/repo/${context.appFolder}`)),
            suggestedRelativePaths: () => Promise.resolve(['dist']),
            value: () => Promise.resolve('dist'),
        });
        const tracker = respondToPrompts(mock, ['acceptDefault']);

        const result = await step.prompt({ appFolder: 'apps/web' });

        expect(mock.workspace.findFiles.mock.calls[0].arguments).to.deep.equal(['apps/web/**/*.json']);
        expect(result.location?.uri.path).to.equal('/repo/apps/web/dist');
        tracker.assertAllConsumed();
    });

    it('projects the selection when the context stores something other than a location', async () => {
        const { ctx, mock } = createMockWorkspace();
        const step = new PickWorkspaceLocationStep<TestContext>(ctx, {
            kind: 'folder',
            strings,
            findFiles: ['**/*'],
            relativeTo: MockUri.file('/repo'),
            suggestedRelativePaths: ['dist'],
            value: 'dist',
            noneLabel: 'No output',
            toContext: location => ({ relativePath: location?.relativePath ?? '' }),
        });
        const tracker = respondToPrompts(mock, ['acceptDefault']);

        const result = await step.prompt({});

        expect(result).to.deep.equal({ relativePath: 'dist' });
        tracker.assertAllConsumed();
    });

    it('projects an explicit none choice as an absent selection', async () => {
        const { ctx, mock } = createMockWorkspace();
        const step = new PickWorkspaceLocationStep<TestContext>(ctx, {
            kind: 'folder',
            strings,
            findFiles: ['**/*'],
            relativeTo: MockUri.file('/repo'),
            noneLabel: 'No output',
            toContext: location => ({ relativePath: location?.relativePath ?? '' }),
        });
        const tracker = respondToPrompts(mock, [{ pick: 'No output' }]);

        const result = await step.prompt({});

        expect(result).to.deep.equal({ relativePath: '' });
        tracker.assertAllConsumed();
    });

    it('normalizes a root initial value to the displayed root label', async () => {
        const { step, mock } = createStep({
            kind: 'folder',
            relativeTo: MockUri.file('/repo'),
            suggestedRelativePaths: ['/'],
            value: '/',
            allowCustom: true,
            strings,
            findFiles: ['**/*'],
        });
        const tracker = respondToPrompts(mock, ['acceptDefault']);

        const result = await step.prompt({});

        expect(mock.quickPicks[0].value).to.equal('.');
        expect(result.location?.relativePath).to.equal('');
        tracker.assertAllConsumed();
    });

    it('preserves an empty initial value for an explicit none choice', async () => {
        const { step, mock } = createStep({
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

        const result = await step.prompt({});

        expect(mock.quickPicks[0].value).to.equal('');
        expect(result).to.have.property('location', undefined);
        tracker.assertAllConsumed();
    });

    it('accepts a custom location that stays inside the workspace', async () => {
        const { step, mock } = createStep({
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

        const result = await step.prompt({});

        expect(result.location?.relativePath).to.equal('../shared');
        expect(result.location?.uri.path).to.equal('/repo/apps/shared');
        tracker.assertAllConsumed();
    });

    it('returns undefined for an explicit none choice', async () => {
        const { step, mock } = createStep({
            kind: 'folder',
            noneLabel: 'No output',
            strings,
            findFiles: ['**/*'],
        });
        const tracker = respondToPrompts(mock, [{ pick: 'No output' }]);

        const result = await step.prompt({});

        expect(result).to.have.property('location', undefined);
        tracker.assertAllConsumed();
    });
});
