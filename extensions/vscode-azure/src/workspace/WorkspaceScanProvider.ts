/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Limiter, stringifyError,
    type DataProvider, type IActionExecutor, type IVsCode,
} from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import type { WorkspaceCandidate, WorkspaceDetector, WorkspaceTagging } from './WorkspaceDetector';
import { entryNodeId, folderNodeId, isWorkspaceEntry, isWorkspaceFolderIndexNode, type WorkspaceEntry, type WorkspaceFolderIndexNode, type WorkspaceIndexNode } from './WorkspaceEntry';
import { ExcludedScanDirectories, MaxScanEntries } from './workspaceExclusions';
import type { AppliedTag } from './WorkspaceTag';

/** Directories read concurrently while walking a workspace folder. */
const ReadDirectoryConcurrency = 8;

/**
 * The single {@linkcode DataProvider} backing the workspace index.
 *
 * The index is stored as a two-level {@linkcode DataItemTree}: workspace folders
 * are the roots, and each folder's children are the flat list of tagged
 * {@linkcode WorkspaceEntry entries} found beneath it. That gives the index
 * TTL-based staleness, keyed eviction, and background enrichment without any
 * bespoke caching code.
 *
 * Scanning a folder is one breadth-first walk whose every file and folder is
 * offered to every detector, so the cost of a scan is the cost of listing the
 * workspace once, independent of how many detectors are registered.
 *
 * `DataItemTree` dispatches each node to the *first* provider whose `canHandle`
 * matches, which would let only one detector ever tag a given folder. So this
 * one provider handles every node and fans out to the detectors itself, merging
 * their taggings by URI. Detector failures are contained per detector, so a
 * broken detector cannot blank the index.
 *
 * @internal Owned by {@linkcode WorkspaceDataService}; not part of the public surface.
 */
export class WorkspaceScanProvider implements DataProvider<WorkspaceIndexNode> {
    public readonly isRoot = true;

    public constructor(
        private readonly code: IVsCode,
        private readonly executor: IActionExecutor,
        private readonly detectors: readonly WorkspaceDetector[],
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is WorkspaceIndexNode {
        return isWorkspaceFolderIndexNode(resource) || isWorkspaceEntry(resource);
    }

    /** @inheritdoc */
    public async getChildren(resource?: WorkspaceIndexNode): Promise<WorkspaceIndexNode[]> {
        if (resource === undefined) {
            return this.getFolderNodes();
        } else if (isWorkspaceFolderIndexNode(resource)) {
            return this.scanFolder(resource);
        } else {
            // Entries are leaves; the index is deliberately flat within a folder.
            return [];
        }
    }

    /**
     * Run every contributing detector's {@linkcode WorkspaceDetector.enrich} for
     * the entry, in the background.
     *
     * Only detectors that already tagged the entry are consulted, so enrichment
     * cannot introduce an entry's first tag from an unrelated detector.
     *
     * @returns Always `false` -- entries are leaves, so enrichment can never
     *   invalidate children.
     */
    public async enrich(resource: WorkspaceIndexNode): Promise<boolean> {
        if (!isWorkspaceEntry(resource)) {
            return false;
        }

        const contributors = this.detectors.filter(
            detector => detector.enrich && resource.tags.some(applied => applied.tag.namespace === detector.namespace),
        );

        await Promise.all(contributors.map(async detector => {
            try {
                await detector.enrich!(resource, this.code); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- filtered on `detector.enrich` above
            } catch (error) {
                this.executor.output.warn(this.code.l10n.t(
                    '[workspace] detector {0} enrich failed: {1}', detector.namespace, stringifyError(error)));
            }
        }));

        return false;
    }

    private getFolderNodes(): WorkspaceFolderIndexNode[] {
        const folders = this.code.workspace.workspaceFolders ?? [];
        return folders.map(folder => ({
            kind: 'folder',
            id: folderNodeId(folder),
            folder,
        }));
    }

    /**
     * Walk one workspace folder breadth-first, offering everything found to
     * every detector, and merge the resulting taggings into entries.
     */
    private async scanFolder(node: WorkspaceFolderIndexNode): Promise<WorkspaceEntry[]> {
        const taggings: WorkspaceTagging[] = [];
        // Detectors that already threw during this scan. Dropped for the rest of
        // the folder so one broken detector cannot log once per file.
        const faulted = new Set<string>();
        const limiter = new Limiter<[string, vscode.FileType][]>(ReadDirectoryConcurrency);

        let visited = 0;
        let truncated = false;
        let level = [node.folder.uri];

        while (level.length > 0 && !truncated) {
            const listings = await Promise.all(level.map(dir => limiter.queue(() => this.readDirectory(dir))));
            const next: vscode.Uri[] = [];

            for (let i = 0; i < level.length && !truncated; i++) {
                for (const [name, type] of listings[i]) {
                    if (++visited > MaxScanEntries) {
                        truncated = true;
                        break;
                    }

                    const isDirectory = (type & this.code.FileType.Directory) !== 0;
                    if (isDirectory && ExcludedScanDirectories.has(name)) {
                        continue;
                    }

                    const uri = this.code.Uri.joinPath(level[i], name);
                    this.visitCandidate({ uri, name, isDirectory, folder: node.folder }, taggings, faulted);

                    // Symlinked directories are not followed, to avoid cycles.
                    if (isDirectory && (type & this.code.FileType.SymbolicLink) === 0) {
                        next.push(uri);
                    }
                }
            }

            level = next;
        }

        if (truncated) {
            this.executor.output.warn(this.code.l10n.t(
                '[workspace] stopped scanning {0} after {1} entries; some projects may be missing',
                node.folder.name, MaxScanEntries));
        }

        const entries = this.mergeTaggings(node, taggings);
        this.executor.output.debug(`[workspace] scanned ${node.folder.name}: visited=${visited} entries=${entries.length}`);
        return entries;
    }

    /** List a directory, treating an unreadable one as empty. */
    private async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        try {
            return await this.code.workspace.fs.readDirectory(uri);
        } catch (error) {
            // Permissions, a race with a delete, a broken remote mount: skip the
            // directory rather than failing the whole scan.
            this.executor.output.debug(`[workspace] could not read ${uri.toString()}: ${stringifyError(error)}`);
            return [];
        }
    }

    /** Offer one candidate to every detector that has not already faulted. */
    private visitCandidate(candidate: WorkspaceCandidate, into: WorkspaceTagging[], faulted: Set<string>): void {
        for (const detector of this.detectors) {
            if (faulted.has(detector.namespace)) {
                continue;
            }
            try {
                const results = detector.visit(candidate);
                if (results && results.length > 0) {
                    into.push(...this.filterToNamespace(detector, results));
                }
            } catch (error) {
                faulted.add(detector.namespace);
                this.executor.output.warn(this.code.l10n.t(
                    '[workspace] detector {0} failed: {1}', detector.namespace, stringifyError(error)));
            }
        }
    }

    /**
     * Drop tags a detector applied outside its own namespace, so a tag's
     * namespace always identifies the detector responsible for it.
     */
    private filterToNamespace(detector: WorkspaceDetector, taggings: readonly WorkspaceTagging[]): WorkspaceTagging[] {
        const result: WorkspaceTagging[] = [];
        for (const tagging of taggings) {
            const tags = tagging.tags.filter(applied => {
                if (applied.tag.namespace === detector.namespace) {
                    return true;
                }
                this.executor.output.warn(this.code.l10n.t(
                    '[workspace] detector {0} tried to apply foreign tag {1}; ignoring',
                    detector.namespace, applied.tag.name));
                return false;
            });
            if (tags.length > 0) {
                result.push({ ...tagging, tags });
            }
        }
        return result;
    }

    /**
     * Collapse taggings from all detectors into one entry per URI, preserving
     * detector registration order within each entry's tag list.
     */
    private mergeTaggings(node: WorkspaceFolderIndexNode, taggings: readonly WorkspaceTagging[]): WorkspaceEntry[] {
        const byUri = new Map<string, WorkspaceEntry>();
        for (const tagging of taggings) {
            const key = tagging.uri.toString();
            const existing = byUri.get(key);
            if (existing) {
                existing.tags.push(...tagging.tags as AppliedTag[]);
            } else {
                byUri.set(key, {
                    kind: 'entry',
                    id: entryNodeId(node.folder, tagging.uri),
                    uri: tagging.uri,
                    folder: node.folder,
                    isDirectory: tagging.isDirectory ?? false,
                    tags: [...tagging.tags],
                });
            }
        }
        return [...byUri.values()];
    }
}
