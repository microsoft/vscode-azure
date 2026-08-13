/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Limiter, stringifyError,
    type DataProvider, type IActionExecutor, type IVsCode,
} from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import type { WorkspaceDetector, WorkspaceScanContext, WorkspaceTagging } from './WorkspaceDetector';
import { entryNodeId, folderNodeId, isWorkspaceEntry, isWorkspaceFolderIndexNode, type WorkspaceEntry, type WorkspaceFolderIndexNode, type WorkspaceIndexNode } from './WorkspaceEntry';
import { DefaultScanExcludeGlob, DefaultScanMaxResults } from './workspaceExclusions';
import type { AppliedTag } from './WorkspaceTag';

/** Max detectors scanned concurrently within a single workspace folder. */
const DetectorConcurrency = 5;

/**
 * The single {@linkcode DataProvider} backing the workspace index.
 *
 * The index is stored as a two-level {@linkcode DataItemTree}: workspace folders
 * are the roots, and each folder's children are the flat list of tagged
 * {@linkcode WorkspaceEntry entries} found beneath it. That gives the index
 * TTL-based staleness, keyed eviction, and background enrichment without any
 * bespoke caching code.
 *
 * `DataItemTree` dispatches each node to the *first* provider whose `canHandle`
 * matches, which would let only one detector ever tag a given folder. So this
 * one provider handles every node and fans out to the registered detectors
 * itself, merging their taggings by URI. Detector failures are contained per
 * detector, so a broken detector cannot blank the index.
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
        if (contributors.length === 0) {
            return false;
        }

        const context = this.createScanContext(resource.folder);
        const limiter = new Limiter<void>(DetectorConcurrency);
        await Promise.all(contributors.map(detector => limiter.queue(async () => {
            try {
                await detector.enrich!(resource, context); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- filtered on `detector.enrich` above
            } catch (error) {
                this.executor.output.warn(this.code.l10n.t(
                    '[workspace] detector {0} enrich failed: {1}', detector.namespace, stringifyError(error)));
            }
        })));

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
     * Scan one workspace folder with every detector and merge the results.
     *
     * Each detector is isolated: a rejection is logged and treated as "no
     * taggings" so the remaining detectors' entries still land in the index.
     */
    private async scanFolder(node: WorkspaceFolderIndexNode): Promise<WorkspaceEntry[]> {
        const context = this.createScanContext(node.folder);
        const limiter = new Limiter<readonly WorkspaceTagging[]>(DetectorConcurrency);

        const results = await Promise.all(this.detectors.map(detector => limiter.queue(async () => {
            try {
                const taggings = await detector.detect(context);
                return this.filterToNamespace(detector, taggings);
            } catch (error) {
                this.executor.output.warn(this.code.l10n.t(
                    '[workspace] detector {0} failed: {1}', detector.namespace, stringifyError(error)));
                return [];
            }
        })));

        const entries = this.mergeTaggings(node, results.flat());
        this.executor.output.debug(`[workspace] scanned ${node.folder.name}: entries=${entries.length} detectors=${this.detectors.length}`);
        return entries;
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

    /**
     * Build the per-scan context. The `findFiles` cache lives on the context, so
     * repeated globs are coalesced within a single folder scan but never reused
     * across scans (which would defeat invalidation).
     */
    private createScanContext(folder: vscode.WorkspaceFolder): WorkspaceScanContext {
        const inFlight = new Map<string, Promise<readonly vscode.Uri[]>>();

        return {
            code: this.code,
            folder,
            findFiles: (pattern: string) => {
                let search = inFlight.get(pattern);
                if (!search) {
                    const relative = new this.code.RelativePattern(folder, pattern);
                    search = Promise.resolve(
                        this.code.workspace.findFiles(relative, DefaultScanExcludeGlob, DefaultScanMaxResults),
                    );
                    inFlight.set(pattern, search);
                }
                return search;
            },
        };
    }
}
