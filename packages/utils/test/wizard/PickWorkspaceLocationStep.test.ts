/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import type * as vscode from 'vscode';
import {
    PickWorkspaceLocationStep,
    type PickWorkspaceLocationOptions,
} from '../../src/wizard/PickWorkspaceLocationStep';
import { projectLocations, type WorkspaceLocation, type WorkspaceLocationSource } from '../../src/wizard/workspaceLocations';
import type { WorkspaceProject } from '../../src/workspace/WorkspaceProject';
import type { IWorkspaceProjectService } from '../../src/workspace/WorkspaceProjectService';
import { createMockCodeContext, respondToPrompts } from '../vscode/MockVsCode';

interface TestContext {
    readonly location?: WorkspaceLocation;
}

const strings = {
    title: 'Select the application location',
    placeHolder: 'Choose the application folder',
};

describe('PickWorkspaceLocationStep (unit)', () => {
    it('fails before prompting when no workspace folder is open', async () => {
        const { ctx, mock } = createMockCodeContext();
        let sourceCalls = 0;
        const source: WorkspaceLocationSource = () => { sourceCalls++; return Promise.resolve([]); };
        const step = new PickWorkspaceLocationStep<TestContext>(ctx, source, {
            strings,
            contextProperty: 'location',
        });

        await expectError(step.prompt({}), 'Open a workspace folder before selecting a location.');

        expect(sourceCalls).to.equal(0);
        expect(mock.quickPicks).to.have.length(0);
    });

    it('reports when the source finds nothing instead of showing an empty pick', async () => {
        const { step, mock } = createStep([], { strings });

        await expectError(step.prompt({}), 'No matching locations were found in the workspace.');

        expect(mock.quickPicks).to.have.length(0);
    });

    it('uses a caller-supplied message when nothing is found', async () => {
        const { step } = createStep([], {
            strings: { ...strings, noneFound: 'No API projects were found.' },
        });

        await expectError(step.prompt({}), 'No API projects were found.');
    });

    it('returns the selected location', async () => {
        const { step, mock } = createStep([location('api', { description: 'nextjs' })], { strings });
        const tracker = respondToPrompts(mock, [{ pick: 'api' }]);

        const result = await step.prompt({});

        expect(result.location?.relativePath).to.equal('api');
        expect(result.location?.uri.path).to.equal('/repo/api');
        tracker.assertAllConsumed();
    });

    it('describes each suggestion with what was detected there', async () => {
        const { step, mock } = createStep(
            [location('.', { description: 'react' }), location('api', {})],
            { strings },
        );
        const tracker = respondToPrompts(mock, [{ pick: '.' }]);

        await step.prompt({});

        expect(mock.quickPicks[0].items.map(item => ({ label: item.label, description: item.description })))
            .to.deep.equal([
                { label: '.', description: 'react' },
                { label: 'api', description: undefined },
            ]);
        tracker.assertAllConsumed();
    });

    it('names the workspace folder only when the workspace has several', async () => {
        const { step, mock } = createStep(
            [location('api', { description: 'react' })],
            { strings },
            ['/repo', '/other'],
        );
        const tracker = respondToPrompts(mock, [{ pick: 'api' }]);

        await step.prompt({});

        expect(mock.quickPicks[0].items[0].description).to.equal('react - repo');
        tracker.assertAllConsumed();
    });
});

describe('projectLocations (unit)', () => {
    it('offers every detected project root by default', async () => {
        const source = projectLocations(serviceWith([
            project('.', { frameworks: ['react'] }),
            project('api', { frameworks: [] }),
        ]));

        const locations = await source();

        expect(locations.map(l => l.relativePath)).to.deep.equal(['.', 'api']);
        expect(locations[0].uri.path).to.equal('/repo');
        expect(locations[0].description).to.equal('react');
        expect(locations[1].description).to.be.undefined;
    });

    it('restricts suggestions with a filter', async () => {
        const source = projectLocations(serviceWith([
            project('web', { frameworks: ['react'] }),
            project('api', { frameworks: ['functions'] }),
        ]), { filter: p => p.frameworks.includes('functions') });

        const locations = await source();

        expect(locations.map(l => l.relativePath)).to.deep.equal(['api']);
    });

    it('offers a sub-path of each project, skipping those without one', async () => {
        const source = projectLocations(serviceWith([
            project('.', { frameworks: ['react'], outputDirectory: 'build' }),
            project('site', { frameworks: ['angular'], outputDirectory: 'dist/app' }),
            project('ssr', { frameworks: ['nextjs'] }),
        ]), { subPath: p => p.outputDirectory });

        const locations = await source();

        expect(locations.map(l => l.relativePath)).to.deep.equal(['build', 'site/dist/app']);
        expect(locations[0].uri.path).to.equal('/repo/build');
        expect(locations[1].uri.path).to.equal('/repo/site/dist/app');
    });

    it('keeps the project root when the sub-path is the project itself', async () => {
        const source = projectLocations(serviceWith([
            project('site', { frameworks: ['html'], outputDirectory: '.' }),
        ]), { subPath: p => p.outputDirectory });

        const [picked] = await source();

        expect(picked.relativePath).to.equal('site');
        expect(picked.uri.path).to.equal('/repo/site');
    });

    it('forwards the cancellation token to the service', async () => {
        const token: vscode.CancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: () => ({ dispose: () => undefined }),
        };
        let received: vscode.CancellationToken | undefined;
        const source = projectLocations({
            getProjects: passed => { received = passed; return Promise.resolve([]); },
            onDidChangeProjects: () => ({ dispose: () => undefined }),
        });

        await source(token);

        expect(received).to.equal(token);
    });
});

function createStep(
    locations: readonly WorkspaceLocation[],
    options: Omit<PickWorkspaceLocationOptions<TestContext>, 'contextProperty'>,
    folders: readonly string[] = ['/repo'],
) {
    const { ctx, mock } = createMockCodeContext();
    folders.forEach((path, index) => {
        mock.workspaceFolders.push({
            uri: ctx.code.Uri.from({ scheme: 'file', path }),
            name: path.slice(1),
            index,
        });
    });

    return {
        step: new PickWorkspaceLocationStep<TestContext>(
            ctx,
            () => Promise.resolve(locations),
            { ...options, contextProperty: 'location' },
        ),
        mock,
    };
}

/** A stand-in service returning fixed projects rooted under `/repo`. */
function serviceWith(projects: readonly WorkspaceProject[]): IWorkspaceProjectService {
    return {
        getProjects: () => Promise.resolve(projects),
        onDidChangeProjects: () => ({ dispose: () => undefined }),
    };
}

function project(relativePath: string, overrides: Partial<WorkspaceProject>): WorkspaceProject {
    return {
        workspaceFolder: { uri: uri('/repo'), name: 'repo', index: 0 },
        rootUri: relativePath === '.' ? uri('/repo') : uri(`/repo/${relativePath}`),
        relativePath,
        frameworks: [],
        buildTools: [],
        languages: [],
        ...overrides,
    };
}

function location(relativePath: string, overrides: Partial<WorkspaceLocation>): WorkspaceLocation {
    return {
        uri: relativePath === '.' ? uri('/repo') : uri(`/repo/${relativePath}`),
        relativePath,
        workspaceFolder: { uri: uri('/repo'), name: 'repo', index: 0 },
        ...overrides,
    };
}

/** A minimal `Uri` supporting the `path` and `with` the source relies on. */
function uri(path: string): vscode.Uri {
    return {
        scheme: 'file',
        authority: '',
        path,
        query: '',
        fragment: '',
        fsPath: path,
        with: (change: { path?: string }) => uri(change.path ?? path),
        toString: () => `file://${path}`,
        toJSON: () => ({ scheme: 'file', path }),
    };
}

async function expectError(promise: Promise<unknown>, message: string): Promise<void> {
    try {
        await promise;
    } catch (error) {
        expect(error).to.be.an('error').with.property('message', message);
        return;
    }
    expect.fail(`Expected an error with message "${message}"`);
}
