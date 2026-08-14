/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DataItemTree, DebounceScheduler, Disposable, EventEmitter, InflightMap, Roots, basename, stringifyError, subtreeOf,
    type Event, type IActionExecutor, type IDebounceScheduler, type IVsCode,
} from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import type { WorkspaceDetector } from './WorkspaceDetector';
import { folderNodeId, isWorkspaceEntry, type WorkspaceEntry, type WorkspaceFolderIndexNode, type WorkspaceIndexNode } from './WorkspaceEntry';
import { isExcludedPath } from './workspaceExclusions';
import { WorkspaceScanProvider } from './WorkspaceScanProvider';
import type { WorkspaceTag } from './WorkspaceTag';

/** Quiet period before a burst of file events triggers a rescan. */
const WatchDebounceMs = 500;

/**
 * How long a folder's scan results stay fresh.
 *
 * The watcher catches the changes that matter, so this is only a backstop for
 * changes VS Code's watcher misses (files arriving outside the workspace's
 * watched scope, external tooling on some remotes). Long enough that repeated
 * wizard queries hit the cache.
 */
const DefaultIndexTtlMs = 5 * 60 * 1000;

export const IWorkspaceDataService: ServiceIdentifier<IWorkspaceDataService> = Symbol.for('IWorkspaceDataService');

/**
 * A single, shared, queryable index of what is in the user's open workspace.
 *
 * {@linkcode WorkspaceDetector Detectors} tag files and folders with namespaced
 * {@linkcode WorkspaceTag tags}; consumers -- tree data providers, wizard steps
 * -- ask for everything carrying a given tag rather than running their own
 * search. This replaces the pattern of each feature hand-rolling a `findFiles`
 * call plus its own file watcher, and means one scan serves every consumer.
 *
 * Results are cached per workspace folder and refreshed automatically when
 * relevant files or the set of workspace folders change.
 */
export interface IWorkspaceDataService extends Disposable {
    /**
     * All entries carrying {@linkcode tag}, across every open workspace folder.
     *
     * Triggers a scan on first use (and after invalidation); concurrent callers
     * share one scan. Returns an empty array when no workspace is open.
     *
     * The returned entries are the index's own objects -- treat them as
     * read-only. They stay identity-stable across enrichment, so a caller may
     * hold one and later await {@linkcode whenEnriched} on it.
     */
    getEntries<TMetadata>(tag: WorkspaceTag<TMetadata>): Promise<readonly WorkspaceEntry[]>;

    /**
     * The indexed entry for {@linkcode uri}, or `undefined` when nothing tagged
     * it.
     *
     * Use to answer "what do we know about this specific location", e.g. for a
     * file the user picked.
     */
    getEntry(uri: vscode.Uri): Promise<WorkspaceEntry | undefined>;

    /**
     * Resolve once background {@linkcode WorkspaceDetector.enrich enrichment}
     * has finished for {@linkcode entry}.
     *
     * Resolves immediately when no detector enriches the entry, or when
     * enrichment already completed. Enrichment failures are contained by the
     * index and never reject this promise.
     */
    whenEnriched(entry: WorkspaceEntry): Promise<WorkspaceEntry>;

    /**
     * Discard cached results so the next query rescans.
     *
     * The service already refreshes itself on file and workspace-folder changes;
     * call this only for changes it cannot observe (e.g. after a tool the
     * extension invoked wrote project files).
     *
     * @param folder - Limit the refresh to one workspace folder. Omit to
     *   refresh everything.
     */
    refresh(folder?: vscode.WorkspaceFolder): void;

    /**
     * Fired when the index changes -- a rescan triggered by a file or
     * workspace-folder change, background enrichment landing, or an explicit
     * {@linkcode refresh}.
     *
     * Consumers should re-query rather than assume what changed. The event is
     * already debounced against bursts of file events. Invalidating something
     * that was never cached fires nothing, since there is no stale result for a
     * consumer to discard.
     */
    readonly onDidChange: Event<void>;
}

/**
 * The production {@linkcode IWorkspaceDataService}.
 *
 * Storage is a private two-level {@linkcode DataItemTree} (workspace folders ->
 * tagged entries) driven by a single {@linkcode WorkspaceScanProvider}; see that
 * class for how one walk feeds every detector. Because the tree is entirely
 * private, the storage strategy can change without affecting consumers.
 *
 * **Cancellation.** Queries are not cancelable: `DataItemTree.getChildren` takes
 * no cancellation token, and threading one through it would be a large change to
 * shared tree infrastructure. Scans are instead kept bounded
 * ({@linkcode MaxScanEntries}) and shared, so a wizard step that abandons a
 * query merely leaves a scan running that warms the cache for the next caller.
 */
export class WorkspaceDataService implements IWorkspaceDataService {
    private readonly tree: DataItemTree<WorkspaceIndexNode>;
    private readonly disposables: Disposable[] = [];
    private readonly changeEmitter = new EventEmitter<void>();

    /**
     * Workspace folders awaiting a rescan, accumulated while the watch debounce
     * is pending. Empty means no per-folder rescan is pending; see
     * {@linkcode pendingAllFolders} for events that could not be attributed to a
     * folder.
     */
    private readonly pendingFolders = new Set<string>();
    /** Set when a file event fell outside every workspace folder, forcing a full rescan. */
    private pendingAllFolders = false;

    /**
     * Collapses concurrent index builds. {@linkcode DataItemTree} does not
     * deduplicate concurrent `getChildren` calls, so without this a wizard step
     * and a tree refresh arriving together would each run a full scan.
     */
    private readonly indexBuilds = new InflightMap<Map<string, WorkspaceEntry[]>>();

    /**
     * The most recent index, kept so a file-change event can be tested against
     * what is currently indexed without awaiting (and so triggering) a scan.
     */
    private lastIndex: Map<string, WorkspaceEntry[]> | undefined;

    public readonly onDidChange = this.changeEmitter.event;

    /**
     * @param code - VS Code API, used for folder enumeration and the watcher.
     * @param executor - Wraps scans in telemetry scopes, and provides the output channel.
     * @param detectors - Contributing detectors. Order determines the order of
     *   tags within an entry; it carries no dispatch meaning, since every
     *   detector sees every file.
     * @param scheduler - Debounces file-change bursts. Injectable so tests can
     *   drive rescans deterministically instead of waiting on timers.
     * @param ttlMs - How long scan results stay fresh.
     */
    public constructor(
        private readonly code: IVsCode,
        executor: IActionExecutor,
        private readonly detectors: readonly WorkspaceDetector[],
        private readonly scheduler: IDebounceScheduler = new DebounceScheduler(
            WatchDebounceMs,
            Symbol('WorkspaceDataService'),
            error => {
                executor.output.warn(code.l10n.t('[workspace] rescan failed: {0}', stringifyError(error)));
            },
        ),
        ttlMs: number = DefaultIndexTtlMs,
    ) {
        this.tree = new DataItemTree<WorkspaceIndexNode>(
            code,
            'workspace-index',
            executor,
            node => node.id,
            ttlMs,
        );
        this.tree.registerProvider(new WorkspaceScanProvider(code, executor, detectors));

        // One watcher for the whole workspace. VS Code already watches the
        // workspace recursively, so a `**/*` watcher is filtered off that
        // existing watcher rather than costing an OS-level watch -- and it means
        // detectors never have to declare what they care about twice.
        const watcher = code.workspace.createFileSystemWatcher('**/*');

        this.disposables.push(
            this.tree,
            this.changeEmitter,
            this.scheduler,
            watcher,
            watcher.onDidCreate(uri => { this.onFileEvent(uri); }),
            watcher.onDidChange(uri => { this.onFileEvent(uri); }),
            watcher.onDidDelete(uri => { this.onFileEvent(uri); }),
            // The set of roots changed; re-list folders but keep the scans of
            // folders that are still open. Invalidation already fires the tree's
            // change event, which is forwarded below -- firing here as well
            // would notify consumers (and so refresh trees) twice per change.
            code.workspace.onDidChangeWorkspaceFolders(() => { this.tree.invalidate(Roots); }),
            // Forward index changes (including background enrichment) to consumers.
            this.tree.onDidChange(() => { this.changeEmitter.fire(); }),
        );
    }

    /** @inheritdoc */
    public async getEntries<TMetadata>(tag: WorkspaceTag<TMetadata>): Promise<readonly WorkspaceEntry[]> {
        const index = await this.getIndex();
        return index.get(tag.name) ?? [];
    }

    /** @inheritdoc */
    public async getEntry(uri: vscode.Uri): Promise<WorkspaceEntry | undefined> {
        const target = uri.toString();
        for (const entries of (await this.getIndex()).values()) {
            const match = entries.find(entry => entry.uri.toString() === target);
            if (match) {
                return match;
            }
        }
        return undefined;
    }

    /** @inheritdoc */
    public async whenEnriched(entry: WorkspaceEntry): Promise<WorkspaceEntry> {
        try {
            return await this.tree.whenEnriched<WorkspaceEntry>(entry);
        } catch {
            // Enrichment is best-effort and already logged by the provider; a
            // caller waiting on it should still get the un-enriched entry rather
            // than an error.
            return entry;
        }
    }

    /** @inheritdoc */
    public refresh(folder?: vscode.WorkspaceFolder): void {
        // Invalidation fires the tree's change event, which is forwarded to
        // consumers; firing again here would notify twice.
        if (folder) {
            this.tree.invalidate(subtreeOf<WorkspaceIndexNode>(folderNodeId(folder)));
        } else {
            this.tree.invalidate(node => isWorkspaceEntry(node) ? undefined : 'subtree');
        }
    }

    /** @inheritdoc */
    public dispose(): void {
        Disposable.from(...this.disposables).dispose();
    }

    /**
     * Build the tag index, scanning any folder whose results are missing or
     * stale.
     *
     * The map is rebuilt from the tree on each call rather than maintained
     * incrementally: the tree owns staleness, and rebuilding is a walk over
     * already-materialized entries, so this keeps a single source of truth.
     *
     * Concurrent callers share one build. A caller that joins a build already in
     * flight when an invalidation lands sees the pre-change results; the
     * {@linkcode onDidChange} that accompanies every invalidation tells it to
     * re-query.
     */
    private getIndex(): Promise<Map<string, WorkspaceEntry[]>> {
        return this.indexBuilds.getOrRun('index', () => this.buildIndex());
    }

    private async buildIndex(): Promise<Map<string, WorkspaceEntry[]>> {
        const folders = await this.tree.getChildren() as WorkspaceFolderIndexNode[];
        const perFolder = await Promise.all(folders.map(folder => this.tree.getChildren(folder)));

        const index = new Map<string, WorkspaceEntry[]>();
        for (const node of perFolder.flat()) {
            if (!isWorkspaceEntry(node)) {
                continue;
            }
            for (const applied of node.tags) {
                const existing = index.get(applied.tag.name);
                if (existing) {
                    existing.push(node);
                } else {
                    index.set(applied.tag.name, [node]);
                }
            }
        }

        this.lastIndex = index;
        return index;
    }

    /**
     * Decide whether a watched file change is worth a rescan.
     *
     * The workspace watcher sees every keystroke-save in the workspace, so the
     * filter has to be cheap: a change matters only if some detector recognizes
     * the name (so a scan would now tag it, or previously did), or if it lands
     * on something already indexed (so deleting a project folder drops it).
     */
    private onFileEvent(uri: vscode.Uri): void {
        if (isExcludedPath(uri)) {
            return;
        }

        const folder = this.code.workspace.getWorkspaceFolder(uri);
        if (folder && !this.isInteresting(uri, folder) && !this.isIndexed(uri)) {
            return;
        }

        this.scheduleRescan(folder);
    }

    /**
     * Whether any detector recognizes {@linkcode uri} by name.
     *
     * Asked as both a file and a directory, since a watcher event does not say
     * which it was (and for a delete, it no longer exists to `stat`).
     */
    private isInteresting(uri: vscode.Uri, folder: vscode.WorkspaceFolder): boolean {
        const name = basename(uri);
        return this.detectors.some(detector => {
            try {
                return [false, true].some(isDirectory =>
                    (detector.visit({ uri, name, isDirectory, folder })?.length ?? 0) > 0);
            } catch {
                // A detector that throws here will be reported by the scan; do
                // not let it suppress rescans in the meantime.
                return true;
            }
        });
    }

    /** Whether {@linkcode uri} is, or contains, something currently indexed. */
    private isIndexed(uri: vscode.Uri): boolean {
        const prefix = uri.toString();
        for (const entries of this.lastIndex?.values() ?? []) {
            if (entries.some(entry => {
                const target = entry.uri.toString();
                return target === prefix || target.startsWith(`${prefix}/`);
            })) {
                return true;
            }
        }
        return false;
    }

    /**
     * Queue a rescan of {@linkcode folder}, or of everything when the change
     * could not be attributed to a folder.
     *
     * Invalidation is folder-granular: a scan is a single walk, and per-detector
     * partitions would buy little for the extra machinery. Bursts (a branch
     * switch, an `npm install`) collapse into one rescan.
     */
    private scheduleRescan(folder: vscode.WorkspaceFolder | undefined): void {
        if (folder) {
            this.pendingFolders.add(folderNodeId(folder));
        } else {
            this.pendingAllFolders = true;
        }

        this.scheduler.debounce(() => {
            const all = this.pendingAllFolders;
            const folderIds = [...this.pendingFolders];
            this.pendingFolders.clear();
            this.pendingAllFolders = false;

            if (all) {
                this.refresh();
            } else if (folderIds.length > 0) {
                this.tree.invalidate(subtreeOf<WorkspaceIndexNode>(...folderIds));
            }
        });
    }
}
