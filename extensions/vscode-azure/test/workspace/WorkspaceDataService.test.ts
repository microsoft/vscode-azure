/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    createTestActionExecutor, ManualDebounceScheduler, MockUri,
    type MockVsCodeResult,
} from '@microsoft/vscode-azure-utils/testing';
import type * as vscode from 'vscode';
import { createMarkerFileDetector, type MarkerFileMetadata } from '../../src/workspace/createMarkerFileDetector';
import { WorkspaceDataService } from '../../src/workspace/WorkspaceDataService';
import type { WorkspaceDetector, WorkspaceScanContext, WorkspaceTagging } from '../../src/workspace/WorkspaceDetector';
import { getTagMetadata, hasTag, type WorkspaceEntry } from '../../src/workspace/WorkspaceEntry';
import { DefaultScanExcludeGlob } from '../../src/workspace/workspaceExclusions';
import { applyTag, defineWorkspaceTag } from '../../src/workspace/WorkspaceTag';

const AzdProjectTag = defineWorkspaceTag<MarkerFileMetadata>('azd', 'project');
const FunctionsProjectTag = defineWorkspaceTag<MarkerFileMetadata>('functions', 'project');
const BareTag = defineWorkspaceTag('test', 'bare');

interface TestHarness {
    readonly service: WorkspaceDataService;
    readonly mock: MockVsCodeResult;
    readonly scheduler: ManualDebounceScheduler;
}

function createService(detectors: readonly WorkspaceDetector[], files: string[] = []): TestHarness {
    const { executor, mockVsCode } = createTestActionExecutor();

    mockVsCode.workspaceFolders.push({ uri: MockUri.file('/repo'), name: 'repo', index: 0 });
    for (const file of files) {
        mockVsCode.fs.addFile(MockUri.file(file), '{}');
    }

    const scheduler = new ManualDebounceScheduler();
    const service = new WorkspaceDataService(mockVsCode.vscode, executor, detectors, scheduler);

    return { service, mock: mockVsCode, scheduler };
}

/** A detector that tags exactly the URIs it is told to, for merge/failure tests. */
function createStubDetector(
    namespace: string,
    detect: (context: WorkspaceScanContext) => Promise<readonly WorkspaceTagging[]>,
    extra?: Partial<WorkspaceDetector>,
): WorkspaceDetector {
    return { namespace, detect, ...extra };
}

describe('WorkspaceDataService (unit)', () => {
    describe('scanning and querying', () => {
        it('returns entries tagged by a marker file detector', async () => {
            const detector = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const { service } = createService([detector], ['/repo/src/azure.yaml']);

            const entries = await service.getEntries(AzdProjectTag);

            expect(entries).to.have.length(1);
            // The containing folder is tagged, not the marker file itself.
            expect(entries[0].uri.path).to.equal('/repo/src');
            expect(entries[0].isDirectory).to.equal(true);
            service.dispose();
        });

        it('exposes the marker file through typed tag metadata', async () => {
            const detector = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const { service } = createService([detector], ['/repo/azure.yaml']);

            const [entry] = await service.getEntries(AzdProjectTag);

            expect(getTagMetadata(entry, AzdProjectTag)?.manifestUri.path).to.equal('/repo/azure.yaml');
            service.dispose();
        });

        it('returns an empty array for a tag nothing carries', async () => {
            const detector = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const { service } = createService([detector], ['/repo/azure.yaml']);

            expect(await service.getEntries(FunctionsProjectTag)).to.deep.equal([]);
            service.dispose();
        });

        it('returns an empty array when no workspace is open', async () => {
            const detector = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const { service, mock } = createService([detector], ['/repo/azure.yaml']);
            mock.workspaceFolders.length = 0;

            expect(await service.getEntries(AzdProjectTag)).to.deep.equal([]);
            service.dispose();
        });

        it('looks up a single entry by uri', async () => {
            const detector = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const { service } = createService([detector], ['/repo/api/azure.yaml']);

            const entry = await service.getEntry(MockUri.file('/repo/api'));
            expect(entry && hasTag(entry, AzdProjectTag)).to.equal(true);

            expect(await service.getEntry(MockUri.file('/repo/nope'))).to.equal(undefined);
            service.dispose();
        });

        it('applies the shared exclusion glob and a result bound to every search', async () => {
            const detector = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const { service, mock } = createService([detector], ['/repo/azure.yaml']);

            await service.getEntries(AzdProjectTag);

            const [, exclude, maxResults] = mock.workspace.findFiles.mock.calls[0].arguments;
            expect(exclude).to.equal(DefaultScanExcludeGlob);
            expect(maxResults).to.be.a('number');
            service.dispose();
        });

        it('does not tag marker files inside excluded directories', async () => {
            const detector = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const { service } = createService(
                [detector],
                ['/repo/azure.yaml', '/repo/node_modules/pkg/azure.yaml'],
            );

            const entries = await service.getEntries(AzdProjectTag);

            expect(entries.map(e => e.uri.path)).to.deep.equal(['/repo']);
            service.dispose();
        });

        it('scopes each search to the workspace folder being scanned', async () => {
            const detector = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const { service, mock } = createService([detector], ['/repo/azure.yaml', '/elsewhere/azure.yaml']);

            const entries = await service.getEntries(AzdProjectTag);

            expect(entries.map(e => e.uri.path)).to.deep.equal(['/repo']);
            const [include] = mock.workspace.findFiles.mock.calls[0].arguments;
            expect(include).to.have.property('pattern', '**/azure.yaml');
            service.dispose();
        });
    });

    describe('multiple detectors', () => {
        it('merges tags from different detectors onto a single entry', async () => {
            const azd = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const functions = createMarkerFileDetector('functions', [
                { tag: FunctionsProjectTag, patterns: ['**/host.json'] },
            ]);
            const { service } = createService([azd, functions], ['/repo/app/azure.yaml', '/repo/app/host.json']);

            const azdEntries = await service.getEntries(AzdProjectTag);
            const functionsEntries = await service.getEntries(FunctionsProjectTag);

            expect(azdEntries).to.have.length(1);
            // Same folder, so the two detectors must converge on one entry object.
            expect(functionsEntries[0]).to.equal(azdEntries[0]);
            expect(hasTag(azdEntries[0], AzdProjectTag)).to.equal(true);
            expect(hasTag(azdEntries[0], FunctionsProjectTag)).to.equal(true);
            service.dispose();
        });

        it('keeps the index usable when one detector throws', async () => {
            const broken = createStubDetector('broken', () => Promise.reject(new Error('boom')));
            const working = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const { service } = createService([broken, working], ['/repo/azure.yaml']);

            expect(await service.getEntries(AzdProjectTag)).to.have.length(1);
            service.dispose();
        });

        it('ignores tags a detector applies outside its own namespace', async () => {
            const rogue = createStubDetector('rogue', context => Promise.resolve([{
                uri: context.folder.uri,
                tags: [applyTag(AzdProjectTag, { manifestUri: context.folder.uri })],
            }]));
            const { service } = createService([rogue]);

            expect(await service.getEntries(AzdProjectTag)).to.deep.equal([]);
            service.dispose();
        });

        it('supports tags applied without metadata', async () => {
            const detector = createStubDetector('test', context => Promise.resolve([{
                uri: context.folder.uri,
                tags: [applyTag(BareTag)],
            }]));
            const { service } = createService([detector]);

            const [entry] = await service.getEntries(BareTag);
            expect(hasTag(entry, BareTag)).to.equal(true);
            expect(entry.tags[0].metadata).to.equal(undefined);
            service.dispose();
        });

        it('runs one search per distinct glob no matter how many detectors ask', async () => {
            const first = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const second = createStubDetector('functions', async context => {
                await context.findFiles('**/azure.yaml');
                return [];
            });
            const { service, mock } = createService([first, second], ['/repo/azure.yaml']);

            await service.getEntries(AzdProjectTag);

            expect(mock.workspace.findFiles.mock.callCount()).to.equal(1);
            service.dispose();
        });
    });

    describe('caching', () => {
        it('serves repeated queries from cache without rescanning', async () => {
            const detector = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const { service, mock } = createService([detector], ['/repo/azure.yaml']);

            await service.getEntries(AzdProjectTag);
            const afterFirst = mock.workspace.findFiles.mock.callCount();
            await service.getEntries(AzdProjectTag);

            expect(mock.workspace.findFiles.mock.callCount()).to.equal(afterFirst);
            service.dispose();
        });

        it('collapses concurrent queries into a single scan', async () => {
            const detector = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const { service, mock } = createService([detector], ['/repo/azure.yaml']);

            await Promise.all([
                service.getEntries(AzdProjectTag),
                service.getEntries(AzdProjectTag),
                service.getEntries(FunctionsProjectTag),
            ]);

            expect(mock.workspace.findFiles.mock.callCount()).to.equal(1);
            service.dispose();
        });

        it('rescans after an explicit refresh', async () => {
            const detector = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const { service, mock } = createService([detector], ['/repo/azure.yaml']);

            await service.getEntries(AzdProjectTag);
            mock.fs.addFile(MockUri.file('/repo/api/azure.yaml'), '{}');
            service.refresh();

            expect(await service.getEntries(AzdProjectTag)).to.have.length(2);
            service.dispose();
        });

        it('rescans stale results once the ttl elapses', async () => {
            const detector = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const { executor, mockVsCode } = createTestActionExecutor();
            mockVsCode.workspaceFolders.push({ uri: MockUri.file('/repo'), name: 'repo', index: 0 });
            mockVsCode.fs.addFile(MockUri.file('/repo/azure.yaml'), '{}');

            // A zero TTL makes every cached listing immediately stale.
            const service = new WorkspaceDataService(
                mockVsCode.vscode, executor, [detector], new ManualDebounceScheduler(), 0);

            await service.getEntries(AzdProjectTag);
            mockVsCode.fs.addFile(MockUri.file('/repo/api/azure.yaml'), '{}');

            expect(await service.getEntries(AzdProjectTag)).to.have.length(2);
            service.dispose();
        });
    });

    describe('change detection', () => {
        it('creates one watcher per distinct declared pattern', () => {
            const azd = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const alsoAzureYaml = createMarkerFileDetector('functions', [
                { tag: FunctionsProjectTag, patterns: ['**/azure.yaml', '**/host.json'] },
            ]);
            const { service, mock } = createService([azd, alsoAzureYaml]);

            expect(mock.fileSystemWatchers.map(w => w.pattern)).to.deep.equal(['**/azure.yaml', '**/host.json']);
            service.dispose();
        });

        it('does not create a watcher for a detector that declares no patterns', () => {
            const { service, mock } = createService([createStubDetector('test', () => Promise.resolve([]))]);

            expect(mock.fileSystemWatchers).to.have.length(0);
            service.dispose();
        });

        it('rescans the affected folder after a watched file appears', async () => {
            const detector = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const { service, mock, scheduler } = createService([detector], ['/repo/azure.yaml']);

            expect(await service.getEntries(AzdProjectTag)).to.have.length(1);

            mock.fs.addFile(MockUri.file('/repo/api/azure.yaml'), '{}');
            mock.fileSystemWatchers[0].createEmitter.fire(MockUri.file('/repo/api/azure.yaml'));
            await scheduler.flush();

            expect(await service.getEntries(AzdProjectTag)).to.have.length(2);
            service.dispose();
        });

        it('debounces a burst of file events into a single rescan', async () => {
            const detector = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const { service, mock, scheduler } = createService([detector], ['/repo/azure.yaml']);
            await service.getEntries(AzdProjectTag);
            const afterFirst = mock.workspace.findFiles.mock.callCount();

            const watcher = mock.fileSystemWatchers[0];
            watcher.createEmitter.fire(MockUri.file('/repo/a/azure.yaml'));
            watcher.changeEmitter.fire(MockUri.file('/repo/b/azure.yaml'));
            watcher.deleteEmitter.fire(MockUri.file('/repo/c/azure.yaml'));
            await scheduler.flush();
            await service.getEntries(AzdProjectTag);

            expect(mock.workspace.findFiles.mock.callCount()).to.equal(afterFirst + 1);
            service.dispose();
        });

        it('fires onDidChange after a rescan', async () => {
            const detector = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const { service, mock, scheduler } = createService([detector], ['/repo/azure.yaml']);
            await service.getEntries(AzdProjectTag);

            let fired = 0;
            service.onDidChange(() => { fired++; });

            mock.fileSystemWatchers[0].createEmitter.fire(MockUri.file('/repo/api/azure.yaml'));
            await scheduler.flush();

            expect(fired).to.be.greaterThan(0);
            service.dispose();
        });

        it('picks up a workspace folder added after the first scan', async () => {
            const detector = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const { service, mock } = createService([detector], ['/repo/azure.yaml', '/other/azure.yaml']);

            expect(await service.getEntries(AzdProjectTag)).to.have.length(1);

            const added: vscode.WorkspaceFolder = { uri: MockUri.file('/other'), name: 'other', index: 1 };
            mock.workspaceFolders.push(added);
            mock.workspaceFoldersChangeEmitter.fire({ added: [added], removed: [] });

            expect(await service.getEntries(AzdProjectTag)).to.have.length(2);
            service.dispose();
        });

        it('drops entries from a removed workspace folder', async () => {
            const detector = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const { service, mock } = createService([detector], ['/repo/azure.yaml']);
            expect(await service.getEntries(AzdProjectTag)).to.have.length(1);

            const [removed] = mock.workspaceFolders.splice(0, 1);
            mock.workspaceFoldersChangeEmitter.fire({ added: [], removed: [removed] });

            expect(await service.getEntries(AzdProjectTag)).to.deep.equal([]);
            service.dispose();
        });

        it('disposes its watchers', () => {
            const detector = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const { service, mock } = createService([detector]);

            service.dispose();

            expect(mock.fileSystemWatchers.every(w => w.disposed)).to.equal(true);
        });
    });

    describe('enrichment', () => {
        it('applies detector enrichment in place and exposes it via whenEnriched', async () => {
            const LateTag = defineWorkspaceTag<{ environment: string }>('azd', 'environment');
            const detector: WorkspaceDetector = {
                ...createMarkerFileDetector('azd', [{ tag: AzdProjectTag, patterns: ['**/azure.yaml'] }]),
                enrich: (entry: WorkspaceEntry) => {
                    entry.tags.push(applyTag(LateTag, { environment: 'dev' }));
                    return Promise.resolve();
                },
            };
            const { service } = createService([detector], ['/repo/azure.yaml']);

            const [entry] = await service.getEntries(AzdProjectTag);
            const enriched = await service.whenEnriched(entry);

            // Enrichment must mutate in place so held references stay valid.
            expect(enriched).to.equal(entry);
            expect(getTagMetadata(enriched, LateTag)?.environment).to.equal('dev');
            service.dispose();
        });

        it('does not reject when enrichment fails', async () => {
            const detector: WorkspaceDetector = {
                ...createMarkerFileDetector('azd', [{ tag: AzdProjectTag, patterns: ['**/azure.yaml'] }]),
                enrich: () => Promise.reject(new Error('boom')),
            };
            const { service } = createService([detector], ['/repo/azure.yaml']);

            const [entry] = await service.getEntries(AzdProjectTag);

            expect(await service.whenEnriched(entry)).to.equal(entry);
            service.dispose();
        });

        it('only enriches through detectors that contributed to the entry', async () => {
            let called = false;
            const azd = createMarkerFileDetector('azd', [
                { tag: AzdProjectTag, patterns: ['**/azure.yaml'] },
            ]);
            const other = createStubDetector('functions', () => Promise.resolve([]), {
                enrich: () => { called = true; return Promise.resolve(); },
            });
            const { service } = createService([azd, other], ['/repo/azure.yaml']);

            const [entry] = await service.getEntries(AzdProjectTag);
            await service.whenEnriched(entry);

            expect(called).to.equal(false);
            service.dispose();
        });
    });
});
