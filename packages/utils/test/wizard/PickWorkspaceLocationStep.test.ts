/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import {
    type FindWorkspaceFilesOptions,
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
        const step = new PickWorkspaceLocationStep<TestContext>(ctx, ['package.json'], {
            kind: 'folder',
            strings,
            contextProperty: 'location',
        });

        await expect(step.prompt({})).to.be.rejectedWith('Open a workspace folder before selecting a location.');
        expect(mock.workspace.findFiles.mock.calls).to.have.length(0);
        expect(mock.quickPicks).to.have.length(0);
    });

    it('passes all findFiles arguments and returns a relative file path', async () => {
        const token: vscode.CancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: () => ({ dispose: () => undefined }),
        };
        const { step, mock } = createStep(['**/*.csproj', '**/obj/**', 12, token], {
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
        const { step, mock } = createStep(['*.json'], {
            kind: 'folder',
            strings: {
                ...strings,
                placeHolder: 'Choose the application folder',
            },
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
});
