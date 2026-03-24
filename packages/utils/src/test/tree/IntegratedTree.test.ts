/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import { ActionExecutor } from '../../base/IActionExecutor';
import { NullTelemetryReporter } from '../../base/ITelemetryReporter';
import type { Page } from '../../data/Page';
import { DataItemTree } from '../../tree/DataItemTree';
import type { DataProvider } from '../../tree/DataProvider';
import { ViewItemTree, type LoadMoreOptions, type ViewItemTreeOptions, createDefaultLoadMoreOptions } from '../../tree/ViewItemTree';
import type { ViewProvider } from '../../tree/ViewProvider';


// ---------------------------------------------------------------------------
// Test resource model
// ---------------------------------------------------------------------------

interface TestResource {
    readonly id: string;
    readonly type: 'folder' | 'file';
    enrichedLabel?: string;
}

// View items carry the resource id and a display label
interface TestViewItem {
    readonly key: string;
    readonly resourceKey: string;
    readonly label: string;
}

// "Load More" helpers

function defaultLoadMoreOptions(): LoadMoreOptions<TestViewItem> {
    return createDefaultLoadMoreOptions<TestViewItem>({
        createViewItem: key => ({ key, resourceKey: key, label: key }),
        getKey: v => v.key,
        getTreeItem: (_parent, loading) => ({
            label: loading ? 'Loading...' : 'Load More...',
        }),
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createExecutor() {
    return new ActionExecutor(new NullTelemetryReporter());
}

function createDataTree(ttl = 60_000) {
    return new DataItemTree<TestResource>('integrated', createExecutor(), r => r.id, ttl);
}

function createPipeline(ttl = 60_000): {
    executor: ActionExecutor;
    dataTree: DataItemTree<TestResource>;
    viewTree: ViewItemTree<TestViewItem, TestResource>;
} {
    const executor = createExecutor();
    const dataTree = new DataItemTree<TestResource>('integrated', executor, r => r.id, ttl);

    const options: ViewItemTreeOptions<TestViewItem, TestResource> = {
        dataItemTree: dataTree,
        toViewItem: r => ({ key: r.id, resourceKey: r.id, label: r.enrichedLabel ?? r.id }),
        getKey: vi => vi.key,
        getResourceKey: vi => vi.resourceKey,
    };

    const viewTree = new ViewItemTree<TestViewItem, TestResource>('integrated', executor, options);
    return { executor, dataTree, viewTree };
}

function createPipelineWithLoadMore(): {
    executor: ActionExecutor;
    dataTree: DataItemTree<TestResource>;
    viewTree: ViewItemTree<TestViewItem, TestResource>;
} {
    const executor = createExecutor();
    const dataTree = new DataItemTree<TestResource>('integrated', executor, r => r.id, 60_000);

    const options: ViewItemTreeOptions<TestViewItem, TestResource> = {
        dataItemTree: dataTree,
        toViewItem: r => ({ key: r.id, resourceKey: r.id, label: r.enrichedLabel ?? r.id }),
        getKey: vi => vi.key,
        getResourceKey: vi => vi.resourceKey,
    };

    const viewTree = new ViewItemTree<TestViewItem, TestResource>('integrated', executor, options, defaultLoadMoreOptions());
    return { executor, dataTree, viewTree };
}

// Data providers

function createRootDataProvider(roots: TestResource[]): DataProvider<TestResource> {
    return {
        isRoot: true,
        canHandle: (_r: unknown): _r is TestResource => false,
        getChildren: () => roots,
    };
}

function createBranchDataProvider(
    childMap: Map<string, TestResource[]>,
    options?: { enrich?: (r: TestResource) => boolean | Promise<boolean> },
): DataProvider<TestResource> {
    return {
        isRoot: false,
        canHandle: (r: unknown): r is TestResource =>
            typeof r === 'object' && r !== null && 'id' in r && childMap.has((r as TestResource).id),
        getChildren: (r?: TestResource) => r ? (childMap.get(r.id) ?? []) : [],
        enrich: options?.enrich,
    };
}

function createPagedDataProvider(
    parentId: string,
    pages: Page<TestResource>[],
): DataProvider<TestResource> {
    return {
        isRoot: false,
        canHandle: (r: unknown): r is TestResource =>
            typeof r === 'object' && r !== null && 'id' in r && (r as TestResource).id === parentId,
        getChildren: () => {
            const iter = pages[Symbol.iterator]();
            return {
                [Symbol.asyncIterator]() {
                    return { next: () => Promise.resolve(iter.next()) };
                },
            };
        },
    };
}

// View providers

function createRootViewProvider(viewItems: TestViewItem[]): ViewProvider<TestViewItem> {
    return {
        isRoot: true,
        canHandle: (_r: unknown): _r is TestViewItem => false,
        getChildren: () => viewItems,
        getTreeItem: vi => ({ label: vi.label, id: vi.key }),
    };
}

function createBranchViewProvider(
    childMap: Map<string, TestViewItem[]>,
    options?: { getParent?: (vi: TestViewItem) => TestViewItem | undefined },
): ViewProvider<TestViewItem> {
    return {
        isRoot: false,
        canHandle: (r: unknown): r is TestViewItem =>
            typeof r === 'object' && r !== null && 'key' in r && childMap.has((r as TestViewItem).key),
        getChildren: (vi?: TestViewItem) => vi ? (childMap.get(vi.key) ?? []) : [],
        getTreeItem: vi => ({ label: vi.label, id: vi.key }),
        getParent: options?.getParent,
    };
}

function vi(id: string, label?: string): TestViewItem {
    return { key: id, resourceKey: id, label: label ?? id };
}

function res(id: string, type: 'folder' | 'file' = 'folder'): TestResource {
    return { id, type };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Tree Integration Tests (integration)', () => {

    // -----------------------------------------------------------------------
    // Full pipeline: data flows from DataProvider through to ViewItemTree
    // -----------------------------------------------------------------------
    describe('full pipeline data flow', () => {
        it('should flow root resources from data to view layer', async () => {
            const { dataTree, viewTree } = createPipeline();

            dataTree.registerProvider(createRootDataProvider([res('a'), res('b')]));
            viewTree.registerProvider(createRootViewProvider([vi('a'), vi('b')]));

            const roots = await viewTree.getChildren();
            expect(roots.map(r => r.key)).to.deep.equal(['a', 'b']);
        });

        it('should render correct tree items from view providers', async () => {
            const { dataTree, viewTree } = createPipeline();

            dataTree.registerProvider(createRootDataProvider([res('root')]));
            viewTree.registerProvider({
                isRoot: true,
                canHandle: (r: unknown): r is TestViewItem =>
                    typeof r === 'object' && r !== null && 'key' in r,
                getChildren: () => [vi('root', 'Root Folder')],
                getTreeItem: (item) => ({
                    label: item.label,
                    id: item.key,
                    contextValue: 'folder',
                }),
            });

            await viewTree.getChildren();
            const treeItem = await viewTree.getTreeItem(vi('root', 'Root Folder'));

            expect(treeItem.label).to.equal('Root Folder');
            expect(treeItem.contextValue).to.equal('folder');
        });

        it('should flow branch resources through both layers', async () => {
            const { dataTree, viewTree } = createPipeline();

            // Data layer
            dataTree.registerProvider(createRootDataProvider([res('folder')]));
            dataTree.registerProvider(createBranchDataProvider(
                new Map([['folder', [res('file1', 'file'), res('file2', 'file')]]]),
            ));

            // View layer
            viewTree.registerProvider(createRootViewProvider([vi('folder')]));
            viewTree.registerProvider(createBranchViewProvider(
                new Map([['folder', [vi('file1'), vi('file2')]]]),
            ));

            // Load tree
            await viewTree.getChildren();
            const children = await viewTree.getChildren(vi('folder'));

            expect(children.map(c => c.key)).to.deep.equal(['file1', 'file2']);
        });

        it('should produce correct getParent for nested nodes', async () => {
            const { dataTree, viewTree } = createPipeline();

            dataTree.registerProvider(createRootDataProvider([res('root')]));
            dataTree.registerProvider(createBranchDataProvider(
                new Map([['root', [res('child')]]]),
            ));

            viewTree.registerProvider(createRootViewProvider([vi('root')]));
            viewTree.registerProvider(createBranchViewProvider(
                new Map([['root', [vi('child')]]]),
            ));

            await viewTree.getChildren();
            await viewTree.getChildren(vi('root'));

            const parent = await viewTree.getParent(vi('child'));
            expect(parent?.key).to.equal('root');
        });

        it('should return undefined parent for root items', async () => {
            const { viewTree } = createPipeline();

            viewTree.registerProvider(createRootViewProvider([vi('root')]));
            await viewTree.getChildren();

            const parent = await viewTree.getParent(vi('root'));
            expect(parent).to.be.undefined;
        });

        it('should support a three-level deep tree', async () => {
            const { dataTree, viewTree } = createPipeline();

            dataTree.registerProvider(createRootDataProvider([res('l1')]));
            dataTree.registerProvider(createBranchDataProvider(
                new Map([
                    ['l1', [res('l2')]],
                    ['l2', [res('l3', 'file')]],
                ]),
            ));

            viewTree.registerProvider(createRootViewProvider([vi('l1')]));
            viewTree.registerProvider(createBranchViewProvider(
                new Map([
                    ['l1', [vi('l2')]],
                    ['l2', [vi('l3')]],
                ]),
            ));

            await viewTree.getChildren();
            await viewTree.getChildren(vi('l1'));
            const level3 = await viewTree.getChildren(vi('l2'));

            expect(level3.map(c => c.key)).to.deep.equal(['l3']);

            // Verify parent chain
            const parentOfL3 = await viewTree.getParent(vi('l3'));
            expect(parentOfL3?.key).to.equal('l2');

            const parentOfL2 = await viewTree.getParent(vi('l2'));
            expect(parentOfL2?.key).to.equal('l1');
        });
    });

    // -----------------------------------------------------------------------
    // Data change propagation
    // -----------------------------------------------------------------------
    describe('data change propagation', () => {
        it('should propagate data tree invalidation to view tree change event', async () => {
            const { dataTree, viewTree } = createPipeline();

            dataTree.registerProvider(createRootDataProvider([res('a')]));
            viewTree.registerProvider(createRootViewProvider([vi('a')]));

            await viewTree.getChildren();

            const onChange = mock.fn();
            viewTree.onDidChangeTreeData(onChange);

            dataTree.invalidate(res('a'));

            expect(onChange.mock.callCount()).to.be.greaterThan(0);
        });

        it('should propagate invalidateAll as undefined (full refresh)', async () => {
            const { dataTree, viewTree } = createPipeline();

            dataTree.registerProvider(createRootDataProvider([res('a')]));
            viewTree.registerProvider(createRootViewProvider([vi('a')]));

            await viewTree.getChildren();

            const onChange = mock.fn();
            viewTree.onDidChangeTreeData(onChange);

            dataTree.invalidateAll();

            const firedUndefined = onChange.mock.calls.some(
                c => c.arguments[0] === undefined,
            );
            expect(firedUndefined).to.be.true;
        });

        it('should propagate provider onDidChange events through both layers', async () => {
            const { dataTree, viewTree } = createPipeline();

            type ChangeHandler = (event: { resource: TestResource; includeChildren: boolean }) => void;
            let fireChange!: ChangeHandler;

            const provider: DataProvider<TestResource> = {
                isRoot: true,
                canHandle: (r: unknown): r is TestResource =>
                    typeof r === 'object' && r !== null && 'id' in r,
                getChildren: () => [res('x')],
                onDidChange: (listener) => {
                    fireChange = listener;
                    return { dispose: () => { /* noop */ } };
                },
            };

            dataTree.registerProvider(provider);
            viewTree.registerProvider(createRootViewProvider([vi('x')]));
            await viewTree.getChildren();

            const onChange = mock.fn();
            viewTree.onDidChangeTreeData(onChange);

            fireChange({ resource: res('x'), includeChildren: true });

            expect(onChange.mock.callCount()).to.be.greaterThan(0);
        });

        it('should not re-fetch sibling children when only one item is invalidated', async () => {
            const { dataTree } = createPipeline();

            dataTree.registerProvider(createRootDataProvider([res('parent')]));

            let siblingACallCount = 0;
            const siblingBFetch = mock.fn(() => [res('b-child', 'file')]);

            dataTree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestResource =>
                    typeof r === 'object' && r !== null && 'id' in r && (r as TestResource).id === 'parent',
                getChildren: () => [res('siblingA'), res('siblingB')],
            });
            dataTree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestResource =>
                    typeof r === 'object' && r !== null && 'id' in r && (r as TestResource).id === 'siblingA',
                getChildren: () => {
                    siblingACallCount++;
                    // Return different data on each call
                    return siblingACallCount === 1
                        ? [res('a-old', 'file')]
                        : [res('a-new', 'file')];
                },
            });
            dataTree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestResource =>
                    typeof r === 'object' && r !== null && 'id' in r && (r as TestResource).id === 'siblingB',
                getChildren: siblingBFetch,
            });

            // Load entire tree
            await dataTree.getChildren();
            await dataTree.getChildren(res('parent'));
            const initialA = await dataTree.getChildren(res('siblingA'));
            await dataTree.getChildren(res('siblingB'));

            expect(initialA.map(c => c.id)).to.deep.equal(['a-old']);
            expect(siblingACallCount).to.equal(1);
            expect(siblingBFetch.mock.callCount()).to.equal(1);

            // Invalidate only siblingA
            dataTree.invalidate(res('siblingA'));

            // Re-fetch siblingA -- should get the new data
            const updatedA = await dataTree.getChildren(res('siblingA'));
            expect(updatedA.map(c => c.id)).to.deep.equal(['a-new']);
            expect(siblingACallCount).to.equal(2);

            // siblingB's children should still be cached -- no re-fetch
            await dataTree.getChildren(res('siblingB'));
            expect(siblingBFetch.mock.callCount()).to.equal(1);
        });

        it('should evict descendants of an invalidated node from the cache', async () => {
            const { dataTree } = createPipeline();

            const grandchildFetch = mock.fn(() => [res('leaf', 'file')]);

            dataTree.registerProvider(createRootDataProvider([res('root')]));
            dataTree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestResource =>
                    typeof r === 'object' && r !== null && 'id' in r && (r as TestResource).id === 'root',
                getChildren: () => [res('child')],
            });
            dataTree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestResource =>
                    typeof r === 'object' && r !== null && 'id' in r && (r as TestResource).id === 'child',
                getChildren: grandchildFetch,
            });

            // Load three levels: root -> child -> leaf
            await dataTree.getChildren();
            await dataTree.getChildren(res('root'));
            await dataTree.getChildren(res('child'));

            expect(dataTree.get('child')).to.not.be.undefined;
            expect(dataTree.get('leaf')).to.not.be.undefined;
            expect(grandchildFetch.mock.callCount()).to.equal(1);

            // Invalidate 'root' -- its descendants (child, leaf) should be evicted
            dataTree.invalidate(res('root'));

            expect(dataTree.get('child')).to.be.undefined;
            expect(dataTree.get('leaf')).to.be.undefined;

            // Re-loading requires walking back down the tree
            await dataTree.getChildren(res('root'));
            await dataTree.getChildren(res('child'));
            expect(grandchildFetch.mock.callCount()).to.equal(2);
        });

        it('should keep children cached when invalidate is called with includeChildren=false', async () => {
            const { dataTree } = createPipeline();

            const childFetch = mock.fn(() => [res('child', 'file')]);

            dataTree.registerProvider(createRootDataProvider([res('parent')]));
            dataTree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestResource =>
                    typeof r === 'object' && r !== null && 'id' in r && (r as TestResource).id === 'parent',
                getChildren: childFetch,
            });

            await dataTree.getChildren();
            await dataTree.getChildren(res('parent'));
            expect(childFetch.mock.callCount()).to.equal(1);

            // Invalidate without clearing children
            const onChange = mock.fn();
            dataTree.onDidChange(onChange);
            dataTree.invalidate(res('parent'), false);

            // Change event should still fire
            expect(onChange.mock.callCount()).to.equal(1);

            // Children are still cached -- no re-fetch
            await dataTree.getChildren(res('parent'));
            expect(childFetch.mock.callCount()).to.equal(1);
            expect(dataTree.get('child')).to.not.be.undefined;
        });

        it('should not affect parent cache when a child is invalidated', async () => {
            const { dataTree } = createPipeline();

            const parentChildFetch = mock.fn(() => [res('childA'), res('childB')]);

            dataTree.registerProvider(createRootDataProvider([res('parent')]));
            dataTree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestResource =>
                    typeof r === 'object' && r !== null && 'id' in r && (r as TestResource).id === 'parent',
                getChildren: parentChildFetch,
            });

            await dataTree.getChildren();
            await dataTree.getChildren(res('parent'));
            expect(parentChildFetch.mock.callCount()).to.equal(1);

            // Invalidate childA -- parent's child list should stay cached
            dataTree.invalidate(res('childA'));

            await dataTree.getChildren(res('parent'));
            expect(parentChildFetch.mock.callCount()).to.equal(1);
        });

        it('should fire change event when invalidating a leaf node', async () => {
            const { dataTree } = createPipeline();

            dataTree.registerProvider(createRootDataProvider([res('leaf', 'file')]));
            await dataTree.getChildren();

            const onChange = mock.fn();
            dataTree.onDidChange(onChange);

            dataTree.invalidate(res('leaf'));

            expect(onChange.mock.callCount()).to.equal(1);
            expect(onChange.mock.calls[0].arguments[0]).to.deep.equal(res('leaf'));
        });

        it('should fire change event with the correct resource identity', async () => {
            const { dataTree, viewTree } = createPipeline();

            dataTree.registerProvider(createRootDataProvider([res('target'), res('other')]));
            viewTree.registerProvider(createRootViewProvider([vi('target'), vi('other')]));

            await viewTree.getChildren();

            const onChange = mock.fn();
            viewTree.onDidChangeTreeData(onChange);

            dataTree.invalidate(res('target'));

            // The view tree should fire with the view item for 'target', not undefined
            expect(onChange.mock.callCount()).to.equal(1);
            const firedItem = onChange.mock.calls[0].arguments[0] as TestViewItem;
            expect(firedItem.key).to.equal('target');
        });

        it('should evict all deeply nested nodes on invalidateAll', async () => {
            const { dataTree } = createPipeline();

            dataTree.registerProvider(createRootDataProvider([res('l1')]));
            dataTree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestResource =>
                    typeof r === 'object' && r !== null && 'id' in r,
                getChildren: (r?: TestResource) => {
                    if (r?.id === 'l1') { return [res('l2')]; }
                    if (r?.id === 'l2') { return [res('l3', 'file')]; }
                    return [];
                },
            });

            await dataTree.getChildren();
            await dataTree.getChildren(res('l1'));
            await dataTree.getChildren(res('l2'));

            expect(dataTree.get('l1')).to.not.be.undefined;
            expect(dataTree.get('l2')).to.not.be.undefined;
            expect(dataTree.get('l3')).to.not.be.undefined;

            dataTree.invalidateAll();

            expect(dataTree.get('l1')).to.be.undefined;
            expect(dataTree.get('l2')).to.be.undefined;
            expect(dataTree.get('l3')).to.be.undefined;
        });

        it('should re-fetch data after invalidation', async () => {
            const { dataTree } = createPipeline();

            let callCount = 0;
            dataTree.registerProvider({
                isRoot: true,
                canHandle: (_r: unknown): _r is TestResource => false,
                getChildren: () => {
                    callCount++;
                    return callCount === 1
                        ? [res('original')]
                        : [res('updated')];
                },
            });

            const first = await dataTree.getChildren();
            expect(first.map(r => r.id)).to.deep.equal(['original']);

            dataTree.invalidateAll();

            const second = await dataTree.getChildren();
            expect(second.map(r => r.id)).to.deep.equal(['updated']);
        });
    });

    // -----------------------------------------------------------------------
    // Enrichment through the stack
    // -----------------------------------------------------------------------
    describe('enrichment through the stack', () => {
        it('should enrich data resources and propagate change to view layer', async () => {
            const { dataTree, viewTree } = createPipeline();

            dataTree.registerProvider({
                isRoot: true,
                canHandle: (r: unknown): r is TestResource =>
                    typeof r === 'object' && r !== null && 'id' in r,
                getChildren: () => [res('item')],
                enrich: (r: TestResource) => {
                    r.enrichedLabel = `Enriched: ${r.id}`;
                    return Promise.resolve(false);
                },
            });

            viewTree.registerProvider(createRootViewProvider([vi('item')]));

            // Load data tree roots so the resource is in the tree
            await dataTree.getChildren();
            await viewTree.getChildren();

            // Wait for enrichment
            const enriched = await dataTree.whenEnriched(dataTree.get('item')!);
            expect(enriched.enrichedLabel).to.equal('Enriched: item');
        });

        it('should enrich branch children after loading', async () => {
            const { dataTree, viewTree } = createPipeline();
            const enrichedIds: string[] = [];

            dataTree.registerProvider(createRootDataProvider([res('parent')]));
            dataTree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestResource =>
                    typeof r === 'object' && r !== null && 'id' in r,
                getChildren: (r?: TestResource) => {
                    if (r?.id === 'parent') {
                        return [res('c1', 'file'), res('c2', 'file')];
                    }
                    return [];
                },
                enrich: (r: TestResource) => {
                    enrichedIds.push(r.id);
                    r.enrichedLabel = `Enriched: ${r.id}`;
                    return Promise.resolve(false);
                },
            });

            viewTree.registerProvider(createRootViewProvider([vi('parent')]));
            viewTree.registerProvider(createBranchViewProvider(
                new Map([['parent', [vi('c1'), vi('c2')]]]),
            ));

            // Load data tree roots first so 'parent' is in the node map
            await dataTree.getChildren();
            await viewTree.getChildren();

            // Load branch children through data tree
            await dataTree.getChildren(res('parent'));

            // Wait for enrichment
            await dataTree.whenEnriched(dataTree.get('c1')!);
            await dataTree.whenEnriched(dataTree.get('c2')!);

            expect(enrichedIds).to.include('c1');
            expect(enrichedIds).to.include('c2');
        });

        it('should invalidate children when enrich returns true', async () => {
            const { dataTree } = createPipeline();

            const fetchCount = mock.fn(() => [res('child', 'file')]);

            // Use a deferred promise to control enrichment timing
            let resolveEnrich!: () => void;
            const enrichPromise = new Promise<void>(r => { resolveEnrich = r; });

            dataTree.registerProvider({
                isRoot: true,
                canHandle: (_r: unknown): _r is TestResource => false,
                getChildren: () => [res('parent')],
            });

            const parentId = 'parent';
            dataTree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestResource =>
                    typeof r === 'object' && r !== null && 'id' in r && (r as TestResource).id === parentId,
                getChildren: fetchCount,
                enrich: async () => {
                    await enrichPromise;
                    return true; // invalidate children
                },
            });

            await dataTree.getChildren();
            await dataTree.getChildren(res('parent'));
            expect(fetchCount.mock.callCount()).to.equal(1);

            // Now let enrichment complete -- it returns true, so children are invalidated
            resolveEnrich();
            await dataTree.whenEnriched(dataTree.get('parent')!);

            // Children were invalidated, so next call re-fetches
            await dataTree.getChildren(res('parent'));
            expect(fetchCount.mock.callCount()).to.equal(2);
        });
    });

    // -----------------------------------------------------------------------
    // Pagination end-to-end
    // -----------------------------------------------------------------------
    describe('pagination end-to-end', () => {
        it('should inject a Load More node when data has more pages', async () => {
            const { dataTree, viewTree } = createPipelineWithLoadMore();

            dataTree.registerProvider(createRootDataProvider([res('parent')]));
            dataTree.registerProvider(createPagedDataProvider('parent', [
                { items: [res('p1', 'file')], hasMore: true },
                { items: [res('p2', 'file')], hasMore: false },
            ]));

            // Pre-load data tree so the view tree can see pagination state
            await dataTree.getChildren();
            await dataTree.getChildren(res('parent'));

            viewTree.registerProvider(createBranchViewProvider(
                new Map([['parent', [vi('p1')]]]),
            ));
            viewTree.registerProvider(createRootViewProvider([vi('parent')]));

            await viewTree.getChildren();
            const children = await viewTree.getChildren(vi('parent'));

            // Last item should be the Load More sentinel
            const lastItem = children[children.length - 1];
            expect(lastItem.key).to.equal(defaultLoadMoreOptions().getLoadMoreViewItem('parent').key);
        });

        it('should load more pages via viewTree.loadMore', async () => {
            const { dataTree, viewTree } = createPipelineWithLoadMore();

            dataTree.registerProvider(createRootDataProvider([res('parent')]));
            dataTree.registerProvider(createPagedDataProvider('parent', [
                { items: [res('a', 'file')], hasMore: true },
                { items: [res('b', 'file')], hasMore: false },
            ]));

            await dataTree.getChildren();
            await dataTree.getChildren(res('parent'));

            viewTree.registerProvider(createBranchViewProvider(
                new Map([['parent', [vi('a')]]]),
            ));
            viewTree.registerProvider(createRootViewProvider([vi('parent')]));

            await viewTree.getChildren();

            const loadMoreItem = defaultLoadMoreOptions().getLoadMoreViewItem('parent');
            await viewTree.loadMore(loadMoreItem);

            expect(dataTree.hasMore(res('parent'))).to.be.false;
        });

        it('should return correct tree item for Load More node', async () => {
            const { viewTree } = createPipelineWithLoadMore();

            viewTree.registerProvider(createRootViewProvider([vi('parent')]));
            await viewTree.getChildren();

            const loadMoreItem = defaultLoadMoreOptions().getLoadMoreViewItem('parent');
            const treeItem = await viewTree.getTreeItem(loadMoreItem);
            expect(treeItem.label).to.equal('Load More...');
        });

        it('should return the parent for a Load More node via getParent', async () => {
            const { viewTree } = createPipelineWithLoadMore();

            viewTree.registerProvider(createRootViewProvider([vi('parent')]));
            await viewTree.getChildren();

            const loadMoreItem = defaultLoadMoreOptions().getLoadMoreViewItem('parent');
            const parent = await viewTree.getParent(loadMoreItem);
            expect(parent?.key).to.equal('parent');
        });
    });

    // -----------------------------------------------------------------------
    // Multi-provider dispatch and registration order
    // -----------------------------------------------------------------------
    describe('multi-provider dispatch', () => {
        it('should dispatch to the first matching provider (registration order)', async () => {
            const { dataTree, viewTree } = createPipeline();

            dataTree.registerProvider(createRootDataProvider([res('item')]));

            // Register specific provider first, then a catch-all
            viewTree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestViewItem =>
                    typeof r === 'object' && r !== null && 'key' in r && (r as TestViewItem).key === 'item',
                getChildren: () => [],
                getTreeItem: () => ({ label: 'Specific Provider' }),
            });
            viewTree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestViewItem =>
                    typeof r === 'object' && r !== null && 'key' in r,
                getChildren: () => [],
                getTreeItem: () => ({ label: 'Catch-All Provider' }),
            });
            viewTree.registerProvider(createRootViewProvider([vi('item')]));

            await viewTree.getChildren();
            const treeItem = await viewTree.getTreeItem(vi('item'));

            expect(treeItem.label).to.equal('Specific Provider');
        });

        it('should merge roots from multiple data providers', async () => {
            const { dataTree, viewTree } = createPipeline();

            dataTree.registerProvider(createRootDataProvider([res('from-provider-1')]));
            dataTree.registerProvider(createRootDataProvider([res('from-provider-2')]));

            viewTree.registerProvider(createRootViewProvider([vi('from-provider-1'), vi('from-provider-2')]));

            const roots = await dataTree.getChildren();
            expect(roots.map(r => r.id)).to.deep.equal(['from-provider-1', 'from-provider-2']);
        });

        it('should dispatch branch children to different providers based on type', async () => {
            const { dataTree } = createPipeline();

            dataTree.registerProvider(createRootDataProvider([res('folders'), res('files')]));
            dataTree.registerProvider(createBranchDataProvider(
                new Map([['folders', [res('f1'), res('f2')]]]),
            ));

            // Provider for "files" parent
            dataTree.registerProvider(createBranchDataProvider(
                new Map([['files', [res('doc.txt', 'file')]]]),
            ));

            await dataTree.getChildren();

            const folderChildren = await dataTree.getChildren(res('folders'));
            expect(folderChildren.map(c => c.id)).to.deep.equal(['f1', 'f2']);

            const fileChildren = await dataTree.getChildren(res('files'));
            expect(fileChildren.map(c => c.id)).to.deep.equal(['doc.txt']);
        });
    });

    // -----------------------------------------------------------------------
    // Provider unregistration
    // -----------------------------------------------------------------------
    describe('provider unregistration', () => {
        it('should remove a data provider when its disposable is disposed', async () => {
            const dataTree = createDataTree();

            const disposable = dataTree.registerProvider(createRootDataProvider([res('a')]));
            const roots = await dataTree.getChildren();
            expect(roots).to.have.length(1);

            disposable.dispose();
            dataTree.invalidateAll(); // clear cached roots

            const afterDispose = await dataTree.getChildren();
            expect(afterDispose).to.have.length(0);
        });

        it('should remove a view provider when its disposable is disposed', async () => {
            const { viewTree } = createPipeline();

            const disposable = viewTree.registerProvider(createRootViewProvider([vi('a')]));
            const roots = await viewTree.getChildren();
            expect(roots).to.have.length(1);

            disposable.dispose();

            const afterDispose = await viewTree.getChildren();
            expect(afterDispose).to.have.length(0);
        });

        it('should fall through to next provider after specific provider is unregistered', async () => {
            const { dataTree, viewTree } = createPipeline();

            dataTree.registerProvider(createRootDataProvider([res('x')]));

            const specific = viewTree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestViewItem =>
                    typeof r === 'object' && r !== null && 'key' in r && (r as TestViewItem).key === 'x',
                getChildren: () => [],
                getTreeItem: () => ({ label: 'Specific' }),
            });
            viewTree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestViewItem =>
                    typeof r === 'object' && r !== null && 'key' in r,
                getChildren: () => [],
                getTreeItem: () => ({ label: 'Fallback' }),
            });
            viewTree.registerProvider(createRootViewProvider([vi('x')]));

            await viewTree.getChildren();
            expect((await viewTree.getTreeItem(vi('x'))).label).to.equal('Specific');

            specific.dispose();

            expect((await viewTree.getTreeItem(vi('x'))).label).to.equal('Fallback');
        });

        it('should stop propagating change events after data tree subscription is disposed', async () => {
            const { dataTree, viewTree } = createPipeline();

            dataTree.registerProvider(createRootDataProvider([res('a')]));
            viewTree.registerProvider(createRootViewProvider([vi('a')]));
            await viewTree.getChildren();

            const onChange = mock.fn();
            viewTree.onDidChangeTreeData(onChange);

            viewTree.dispose();

            dataTree.invalidateAll();
            expect(onChange.mock.callCount()).to.equal(0);
        });
    });

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------
    describe('edge cases', () => {
        it('should handle empty tree with no providers', async () => {
            const { dataTree, viewTree } = createPipeline();

            const dataRoots = await dataTree.getChildren();
            expect(dataRoots).to.deep.equal([]);

            const viewRoots = await viewTree.getChildren();
            expect(viewRoots).to.deep.equal([]);
        });

        it('should handle leaf nodes with no children', async () => {
            const { dataTree, viewTree } = createPipeline();

            dataTree.registerProvider(createRootDataProvider([res('leaf', 'file')]));

            viewTree.registerProvider(createRootViewProvider([vi('leaf')]));
            // No branch provider, so "leaf" has no children

            await dataTree.getChildren();
            await viewTree.getChildren();

            const viewChildren = await viewTree.getChildren(vi('leaf'));
            expect(viewChildren).to.deep.equal([]);
        });

        it('should return empty for unknown view item in getBranchChildren', async () => {
            const { viewTree } = createPipeline();

            viewTree.registerProvider(createRootViewProvider([vi('root')]));
            await viewTree.getChildren();

            // 'ghost' was never loaded so it is not in the node map
            const children = await viewTree.getChildren(vi('ghost'));
            expect(children).to.deep.equal([]);
        });

        it('should support provider getParent fallback for uncached nodes', async () => {
            const { viewTree } = createPipeline();

            viewTree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestViewItem =>
                    typeof r === 'object' && r !== null && 'key' in r && (r as TestViewItem).key === 'deep-child',
                getChildren: () => [],
                getTreeItem: (item) => ({ label: item.label, id: item.key }),
                getParent: (item) =>
                    item.key === 'deep-child' ? vi('computed-parent') : undefined,
            });

            // 'deep-child' was never loaded via getChildren, so the node map is empty.
            // getParent should fall back to the provider's getParent method.
            const parent = await viewTree.getParent(vi('deep-child'));
            expect(parent?.key).to.equal('computed-parent');
        });
    });
});
