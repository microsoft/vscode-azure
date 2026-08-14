/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    createTestActionExecutor, ManualDebounceScheduler, MockUri,
    type MockVsCodeResult,
} from '@microsoft/vscode-azure-utils/testing';
import { dirname } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import { WorkspaceDataService } from '../../src/workspace/WorkspaceDataService';
import type { WorkspaceCandidate, WorkspaceDetector, WorkspaceTagging } from '../../src/workspace/WorkspaceDetector';
import { getTagMetadata, hasTag, type WorkspaceEntry } from '../../src/workspace/WorkspaceEntry';
import { applyTag, defineWorkspaceTag, type WorkspaceTag } from '../../src/workspace/WorkspaceTag';

interface ManifestMetadata {
    readonly manifestUri: vscode.Uri;
}

const AzdProjectTag = defineWorkspaceTag<ManifestMetadata>('azd', 'project');
const FunctionsProjectTag = defineWorkspaceTag<ManifestMetadata>('functions', 'project');
const BareTag = defineWorkspaceTag('test', 'bare');

/** A detector that tags the folder containing a file of the given name. */
function createFileNameDetector(
    namespace: string,
    fileName: string,
    tag: WorkspaceTag<ManifestMetadata>,
): WorkspaceDetector {
    return {
        namespace,
        visit: candidate => candidate.isDirectory || candidate.name !== fileName
            ? undefined
            : [{
                uri: dirname(candidate.uri),
                isDirectory: true,
                tags: [applyTag(tag, { manifestUri: candidate.uri })],
            }],
    };
}

/** The detector every scanning test uses: `azure.yaml` marks an azd project. */
function createAzdDetector(): WorkspaceDetector {
    return createFileNameDetector('azd', 'azure.yaml', AzdProjectTag);
}

interface TestHarness {
    readonly service: WorkspaceDataService;
    readonly mock: MockVsCodeResult;
    readonly scheduler: ManualDebounceScheduler;
    /** How many directories the walk has listed, i.e. how much scanning happened. */
    readonly scans: () => number;
}

function createService(detectors: readonly WorkspaceDetector[], files: string[] = []): TestHarness {
    const { executor, mockVsCode } = createTestActionExecutor();

    mockVsCode.workspaceFolders.push({ uri: MockUri.file('/repo'), name: 'repo', index: 0 });
    for (const file of files) {
        mockVsCode.fs.addFile(MockUri.file(file), '{}');
    }

    const scheduler = new ManualDebounceScheduler();
    const service = new WorkspaceDataService(mockVsCode.vscode, executor, detectors, scheduler);

    return {
        service,
        mock: mockVsCode,
        scheduler,
        scans: () => mockVsCode.fs.readDirectory.mock.callCount(),
    };
}

/** A detector that tags exactly what it is told to, for merge/failure tests. */
function createStubDetector(
    namespace: string,
    visit: (candidate: WorkspaceCandidate) => readonly WorkspaceTagging[] | undefined,
    extra?: Partial<WorkspaceDetector>,
): WorkspaceDetector {
    return { namespace, visit, ...extra };
}

describe('WorkspaceDataService (unit)', () => {
    describe('scanning and querying', () => {
        it('returns entries tagged by a marker file detector', async () => {
            const { service } = createService([createAzdDetector()], ['/repo/src/azure.yaml']);

            const entries = await service.getEntries(AzdProjectTag);

            expect(entries).to.have.length(1);
            // The containing folder is tagged, not the marker file itself.
            expect(entries[0].uri.path).to.equal('/repo/src');
            expect(entries[0].isDirectory).to.equal(true);
            service.dispose();
        });

        it('finds marker files at any depth', async () => {
            const { service } = createService(
                [createAzdDetector()],
                ['/repo/azure.yaml', '/repo/a/b/c/azure.yaml'],
            );

            const entries = await service.getEntries(AzdProjectTag);

            expect(entries.map(e => e.uri.path).sort()).to.deep.equal(['/repo', '/repo/a/b/c']);
            service.dispose();
        });

        it('exposes the marker file through typed tag metadata', async () => {
            const { service } = createService([createAzdDetector()], ['/repo/azure.yaml']);

            const [entry] = await service.getEntries(AzdProjectTag);

            expect(getTagMetadata(entry, AzdProjectTag)?.manifestUri.path).to.equal('/repo/azure.yaml');
            service.dispose();
        });

        it('returns an empty array for a tag nothing carries', async () => {
            const { service } = createService([createAzdDetector()], ['/repo/azure.yaml']);

            expect(await service.getEntries(FunctionsProjectTag)).to.deep.equal([]);
            service.dispose();
        });

        it('returns an empty array when no workspace is open', async () => {
            const { service, mock } = createService([createAzdDetector()], ['/repo/azure.yaml']);
            mock.workspaceFolders.length = 0;

            expect(await service.getEntries(AzdProjectTag)).to.deep.equal([]);
            service.dispose();
        });

        it('looks up a single entry by uri', async () => {
            const { service } = createService([createAzdDetector()], ['/repo/api/azure.yaml']);

            const entry = await service.getEntry(MockUri.file('/repo/api'));
            expect(entry && hasTag(entry, AzdProjectTag)).to.equal(true);

            expect(await service.getEntry(MockUri.file('/repo/nope'))).to.equal(undefined);
            service.dispose();
        });

        it('offers directories to detectors as well as files', async () => {
            const seen: string[] = [];
            const detector = createStubDetector('test', candidate => {
                if (candidate.isDirectory) {
                    seen.push(candidate.name);
                }
                return undefined;
            });
            const { service } = createService([detector], ['/repo/api/index.js']);

            await service.getEntries(BareTag);

            expect(seen).to.deep.equal(['api']);
            service.dispose();
        });

        it('does not descend into excluded directories', async () => {
            const { service } = createService(
                [createAzdDetector()],
                ['/repo/azure.yaml', '/repo/node_modules/pkg/azure.yaml'],
            );

            const entries = await service.getEntries(AzdProjectTag);

            expect(entries.map(e => e.uri.path)).to.deep.equal(['/repo']);
            service.dispose();
        });

        it('does not follow symlinked directories', async () => {
            const { service, mock } = createService(
                [createAzdDetector()],
                ['/repo/azure.yaml', '/repo/link/azure.yaml'],
            );
            mock.fs.addSymbolicLink(MockUri.file('/repo/link'), mock.vscode.FileType.Directory);

            const entries = await service.getEntries(AzdProjectTag);

            expect(entries.map(e => e.uri.path)).to.deep.equal(['/repo']);
            service.dispose();
        });

        it('scopes the walk to open workspace folders', async () => {
            const { service } = createService([createAzdDetector()], ['/repo/azure.yaml', '/elsewhere/azure.yaml']);

            const entries = await service.getEntries(AzdProjectTag);

            expect(entries.map(e => e.uri.path)).to.deep.equal(['/repo']);
            service.dispose();
        });

        it('survives a directory it cannot read', async () => {
            const { service, mock } = createService([createAzdDetector()], ['/repo/azure.yaml']);
            mock.fs.readDirectory.mock.mockImplementation(() => Promise.reject(new Error('EACCES')));

            expect(await service.getEntries(AzdProjectTag)).to.deep.equal([]);
            service.dispose();
        });
    });

    describe('multiple detectors', () => {
        it('merges tags from different detectors onto a single entry', async () => {
            const azd = createAzdDetector();
            const functions = createFileNameDetector('functions', 'host.json', FunctionsProjectTag);
            const { service } = createService([azd, functions], ['/repo/app/azure.yaml', '/repo/app/host.json']);

            const azdEntries = await service.getEntries(AzdProjectTag);
            const functionsEntries = await service.getEntries(FunctionsProjectTag);

            expect(azdEntries).to.have.length(1);
            // Same folder, so the two detectors must converge on one entry object.
            expect(functionsEntries[0]).to.equal(azdEntries[0]);
            expect(hasTag(azdEntries[0], FunctionsProjectTag)).to.equal(true);
            service.dispose();
        });

        it('keeps the index usable when one detector throws', async () => {
            const broken = createStubDetector('broken', () => { throw new Error('boom'); });
            const { service } = createService([broken, createAzdDetector()], ['/repo/azure.yaml']);

            expect(await service.getEntries(AzdProjectTag)).to.have.length(1);
            service.dispose();
        });

        it('ignores tags a detector applies outside its own namespace', async () => {
            const rogue = createStubDetector('rogue', candidate => [{
                uri: candidate.folder.uri,
                tags: [applyTag(AzdProjectTag, { manifestUri: candidate.uri })],
            }]);
            const { service } = createService([rogue], ['/repo/azure.yaml']);

            expect(await service.getEntries(AzdProjectTag)).to.deep.equal([]);
            service.dispose();
        });

        it('supports tags applied without metadata', async () => {
            const detector = createStubDetector('test', candidate => candidate.name === 'azure.yaml'
                ? [{ uri: candidate.folder.uri, tags: [applyTag(BareTag)] }]
                : undefined);
            const { service } = createService([detector], ['/repo/azure.yaml']);

            const [entry] = await service.getEntries(BareTag);
            expect(hasTag(entry, BareTag)).to.equal(true);
            expect(entry.tags[0].metadata).to.equal(undefined);
            service.dispose();
        });

        it('walks the workspace once no matter how many detectors are registered', async () => {
            const files = ['/repo/a/azure.yaml', '/repo/b/c/host.json'];
            const one = createService([createAzdDetector()], files);
            await one.service.getEntries(AzdProjectTag);

            const many = createService(
                [createAzdDetector(), createStubDetector('x', () => undefined), createStubDetector('y', () => undefined)],
                files,
            );
            await many.service.getEntries(AzdProjectTag);

            expect(many.scans()).to.equal(one.scans());
            one.service.dispose();
            many.service.dispose();
        });
    });

    describe('caching', () => {
        it('serves repeated queries from cache without rescanning', async () => {
            const { service, scans } = createService([createAzdDetector()], ['/repo/azure.yaml']);

            await service.getEntries(AzdProjectTag);
            const afterFirst = scans();
            await service.getEntries(AzdProjectTag);

            expect(scans()).to.equal(afterFirst);
            service.dispose();
        });

        it('collapses concurrent queries into a single scan', async () => {
            const { service, scans } = createService([createAzdDetector()], ['/repo/azure.yaml']);

            await Promise.all([
                service.getEntries(AzdProjectTag),
                service.getEntries(AzdProjectTag),
                service.getEntries(FunctionsProjectTag),
            ]);

            // One listing of `/repo`, and no folder was listed twice.
            expect(scans()).to.equal(1);
            service.dispose();
        });
    });

    describe('change detection', () => {
        it('creates exactly one watcher for the whole workspace', () => {
            const { service, mock } = createService([
                createAzdDetector(),
                createFileNameDetector('functions', 'host.json', FunctionsProjectTag),
            ]);

            expect(mock.fileSystemWatchers.map(w => w.pattern)).to.deep.equal(['**/*']);
            service.dispose();
        });

        it('rescans the affected folder after a file a detector recognizes appears', async () => {
            const { service, mock, scheduler } = createService([createAzdDetector()], ['/repo/azure.yaml']);

            expect(await service.getEntries(AzdProjectTag)).to.have.length(1);

            mock.fs.addFile(MockUri.file('/repo/api/azure.yaml'), '{}');
            mock.fileSystemWatchers[0].createEmitter.fire(MockUri.file('/repo/api/azure.yaml'));
            await scheduler.flush();

            expect(await service.getEntries(AzdProjectTag)).to.have.length(2);
            service.dispose();
        });

        it('ignores changes to files no detector recognizes', async () => {
            const { service, mock, scheduler, scans } = createService([createAzdDetector()], ['/repo/azure.yaml']);
            await service.getEntries(AzdProjectTag);
            const afterFirst = scans();

            mock.fileSystemWatchers[0].changeEmitter.fire(MockUri.file('/repo/src/index.ts'));
            expect(scheduler.hasPending).to.equal(false);
            await service.getEntries(AzdProjectTag);

            expect(scans()).to.equal(afterFirst);
            service.dispose();
        });

        it('ignores changes inside excluded directories', async () => {
            const { service, mock, scheduler, scans } = createService([createAzdDetector()], ['/repo/azure.yaml']);
            await service.getEntries(AzdProjectTag);
            const afterFirst = scans();

            // An `npm install` writing a vendored marker file must not rescan.
            mock.fileSystemWatchers[0].createEmitter.fire(MockUri.file('/repo/node_modules/pkg/azure.yaml'));
            expect(scheduler.hasPending).to.equal(false);
            await service.getEntries(AzdProjectTag);

            expect(scans()).to.equal(afterFirst);
            service.dispose();
        });

        it('rescans when an indexed folder is deleted', async () => {
            const { service, mock, scheduler } = createService(
                [createAzdDetector()],
                ['/repo/azure.yaml', '/repo/api/azure.yaml'],
            );
            expect(await service.getEntries(AzdProjectTag)).to.have.length(2);

            await mock.fs.delete(MockUri.file('/repo/api/azure.yaml'));
            await mock.fs.delete(MockUri.file('/repo/api'));
            // The watcher reports the folder, whose name no detector recognizes;
            // it still matters because the index has an entry underneath it.
            mock.fileSystemWatchers[0].deleteEmitter.fire(MockUri.file('/repo/api'));
            await scheduler.flush();

            expect(await service.getEntries(AzdProjectTag)).to.have.length(1);
            service.dispose();
        });

        it('debounces a burst of file events into a single rescan', async () => {
            const { service, mock, scheduler, scans } = createService([createAzdDetector()], ['/repo/azure.yaml']);
            await service.getEntries(AzdProjectTag);
            const afterFirst = scans();

            const watcher = mock.fileSystemWatchers[0];
            watcher.createEmitter.fire(MockUri.file('/repo/a/azure.yaml'));
            watcher.changeEmitter.fire(MockUri.file('/repo/b/azure.yaml'));
            watcher.deleteEmitter.fire(MockUri.file('/repo/c/azure.yaml'));
            await scheduler.flush();
            await service.getEntries(AzdProjectTag);

            // One extra listing of `/repo`, not three.
            expect(scans()).to.equal(afterFirst + 1);
            service.dispose();
        });

        it('fires onDidChange after a rescan', async () => {
            const { service, mock, scheduler } = createService([createAzdDetector()], ['/repo/azure.yaml']);
            await service.getEntries(AzdProjectTag);

            let fired = 0;
            service.onDidChange(() => { fired++; });

            mock.fileSystemWatchers[0].createEmitter.fire(MockUri.file('/repo/api/azure.yaml'));
            await scheduler.flush();

            expect(fired).to.be.greaterThan(0);
            service.dispose();
        });

        it('picks up a workspace folder added after the first scan', async () => {
            const { service, mock } = createService([createAzdDetector()], ['/repo/azure.yaml', '/other/azure.yaml']);

            expect(await service.getEntries(AzdProjectTag)).to.have.length(1);

            const added: vscode.WorkspaceFolder = { uri: MockUri.file('/other'), name: 'other', index: 1 };
            mock.workspaceFolders.push(added);
            mock.workspaceFoldersChangeEmitter.fire({ added: [added], removed: [] });

            expect(await service.getEntries(AzdProjectTag)).to.have.length(2);
            service.dispose();
        });

        it('drops entries from a removed workspace folder', async () => {
            const { service, mock } = createService([createAzdDetector()], ['/repo/azure.yaml']);
            expect(await service.getEntries(AzdProjectTag)).to.have.length(1);

            const [removed] = mock.workspaceFolders.splice(0, 1);
            mock.workspaceFoldersChangeEmitter.fire({ added: [], removed: [removed] });

            expect(await service.getEntries(AzdProjectTag)).to.deep.equal([]);
            service.dispose();
        });

        it('disposes its watcher', () => {
            const { service, mock } = createService([createAzdDetector()]);

            service.dispose();

            expect(mock.fileSystemWatchers.every(w => w.disposed)).to.equal(true);
        });
    });

    describe('enrichment', () => {
        it('applies detector enrichment in place and exposes it via whenEnriched', async () => {
            const LateTag = defineWorkspaceTag<{ environment: string }>('azd', 'environment');
            const detector: WorkspaceDetector = {
                ...createAzdDetector(),
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
                ...createAzdDetector(),
                enrich: () => Promise.reject(new Error('boom')),
            };
            const { service } = createService([detector], ['/repo/azure.yaml']);

            const [entry] = await service.getEntries(AzdProjectTag);

            expect(await service.whenEnriched(entry)).to.equal(entry);
            service.dispose();
        });

        it('only enriches through detectors that contributed to the entry', async () => {
            let called = false;
            const other = createStubDetector('functions', () => undefined, {
                enrich: () => { called = true; return Promise.resolve(); },
            });
            const { service } = createService([createAzdDetector(), other], ['/repo/azure.yaml']);

            const [entry] = await service.getEntries(AzdProjectTag);
            await service.whenEnriched(entry);

            expect(called).to.equal(false);
            service.dispose();
        });
    });
});
