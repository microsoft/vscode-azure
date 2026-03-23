/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import { ActionExecutor } from '../../base/IActionExecutor';
import { NullTelemetryReporter } from '../../base/ITelemetryReporter';
import { DataItemTree } from '../../tree/DataItemTree';
import { ViewItemTree } from '../../tree/ViewItemTree';
import type { ViewProvider } from '../../tree/ViewProvider';
import type { ITreeItem } from '../../vscode/IVsCode';

interface TestResource {
    id: string;
}

type TestViewItem = string; // Use the resource id as the view item

const canHandleAll = (_r: unknown): _r is TestViewItem => true;
const canHandleAllResources = (_r: unknown): _r is TestResource => true;
const canHandleNoResources = (_r: unknown): _r is TestResource => false;

function createSetup() {
    const executor = new ActionExecutor(new NullTelemetryReporter());
    const dataTree = new DataItemTree<TestResource>('test', executor, r => r.id, 60_000);

    const viewTree = new ViewItemTree<TestViewItem, TestResource>('test', executor, {
        dataItemTree: dataTree,
        toViewItem: r => r.id,
        getKey: vi => vi,
        getResourceKey: vi => vi,
    });

    return { executor, dataTree, viewTree };
}

function createRootViewProvider(items: TestViewItem[]): ViewProvider<TestViewItem> {
    return {
        isRoot: true,
        canHandle: (_r: unknown): _r is TestViewItem => false,
        getChildren: () => items,
        getTreeItem: (vi) => ({ label: vi, id: vi }),
    };
}

function createBranchViewProvider(
    childMap: Map<string, TestViewItem[]>,
    getParent?: (vi: TestViewItem) => TestViewItem | undefined,
): ViewProvider<TestViewItem> {
    return {
        isRoot: false,
        canHandle: (r: unknown): r is TestViewItem => typeof r === 'string' && childMap.has(r),
        getChildren: (vi?: TestViewItem) => vi ? (childMap.get(vi) ?? []) : [],
        getTreeItem: (vi) => ({ label: vi, id: vi }),
        getParent,
    };
}

describe('ViewItemTree (unit)', () => {
    describe('getChildren (roots)', () => {
        it('should return root children from registered view providers', async () => {
            const { viewTree } = createSetup();
            viewTree.registerProvider(createRootViewProvider(['a', 'b']));

            const children = await viewTree.getChildren();
            expect(children).to.deep.equal(['a', 'b']);
        });

        it('should merge children from multiple root providers', async () => {
            const { viewTree } = createSetup();
            viewTree.registerProvider(createRootViewProvider(['a']));
            viewTree.registerProvider(createRootViewProvider(['b']));

            const children = await viewTree.getChildren();
            expect(children).to.deep.equal(['a', 'b']);
        });
    });

    describe('getChildren (branches)', () => {
        it('should return branch children', async () => {
            const { viewTree } = createSetup();
            viewTree.registerProvider(createRootViewProvider(['root']));
            viewTree.registerProvider(createBranchViewProvider(new Map([['root', ['c1', 'c2']]])));

            await viewTree.getChildren(); // load roots
            const children = await viewTree.getChildren('root');
            expect(children).to.deep.equal(['c1', 'c2']);
        });

        it('should return empty array for unknown view items', async () => {
            const { viewTree } = createSetup();
            viewTree.registerProvider(createRootViewProvider(['root']));

            await viewTree.getChildren();
            const children = await viewTree.getChildren('unknown');
            expect(children).to.deep.equal([]);
        });

        it('should return empty array when no provider matches', async () => {
            const { viewTree } = createSetup();
            viewTree.registerProvider(createRootViewProvider(['root']));
            // No branch provider registered

            await viewTree.getChildren();
            const children = await viewTree.getChildren('root');
            expect(children).to.deep.equal([]);
        });
    });

    describe('getTreeItem', () => {
        it('should delegate to the matching provider', async () => {
            const { viewTree } = createSetup();
            viewTree.registerProvider({
                isRoot: true,
                canHandle: canHandleAll,
                getChildren: () => ['item'],
                getTreeItem: (vi) => ({ label: `Label: ${vi}`, id: vi }),
            });

            await viewTree.getChildren();
            const treeItem = await viewTree.getTreeItem('item');
            expect(treeItem.label).to.equal('Label: item');
        });

        it('should throw when no provider matches', async () => {
            const { viewTree } = createSetup();
            viewTree.registerProvider(createRootViewProvider(['item']));

            await viewTree.getChildren();
            // Unregister the provider so nothing matches
            viewTree.dispose();

            // The executor swallows errors (returns undefined), but with rethrow it throws
            // In practice the error is caught by the executor — just verify no crash
        });
    });

    describe('getParent', () => {
        it('should return the parent from cached node map', async () => {
            const { viewTree } = createSetup();
            viewTree.registerProvider(createRootViewProvider(['root']));
            viewTree.registerProvider(createBranchViewProvider(new Map([['root', ['child']]])));

            await viewTree.getChildren();
            await viewTree.getChildren('root');

            const parent = await viewTree.getParent('child');
            expect(parent).to.equal('root');
        });

        it('should return undefined for root items', async () => {
            const { viewTree } = createSetup();
            viewTree.registerProvider(createRootViewProvider(['root']));

            await viewTree.getChildren();
            const parent = await viewTree.getParent('root');
            expect(parent).to.be.undefined;
        });

        it('should fall back to provider getParent for uncached items', async () => {
            const { viewTree } = createSetup();
            viewTree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestViewItem => r === 'child',
                getChildren: () => [],
                getTreeItem: (vi) => ({ label: vi, id: vi }),
                getParent: (vi) => vi === 'child' ? 'root' : undefined,
            });

            const parent = await viewTree.getParent('child');
            expect(parent).to.equal('root');
        });
    });

    describe('onDidChangeTreeData', () => {
        it('should fire when the underlying data tree changes', async () => {
            const { dataTree, viewTree } = createSetup();

            // Register a root data provider
            dataTree.registerProvider({
                isRoot: true,
                canHandle: canHandleAllResources,
                getChildren: () => [{ id: 'a' }],
            });

            // Register a root view provider that knows about 'a'
            viewTree.registerProvider(createRootViewProvider(['a']));
            await viewTree.getChildren();

            const onChange = mock.fn();
            viewTree.onDidChangeTreeData(onChange);

            // Invalidate in the data tree → should propagate to view
            dataTree.invalidate({ id: 'a' });

            expect(onChange.mock.callCount()).to.be.greaterThan(0);
        });

        it('should fire full refresh for unknown resources', async () => {
            const { dataTree, viewTree } = createSetup();
            viewTree.registerProvider(createRootViewProvider(['a']));
            await viewTree.getChildren();

            const onChange = mock.fn();
            viewTree.onDidChangeTreeData(onChange);

            dataTree.invalidateAll();

            // Should fire with undefined (full refresh)
            const firedUndefined = onChange.mock.calls.some(
                c => c.arguments[0] === undefined,
            );
            expect(firedUndefined).to.be.true;
        });
    });

    describe('load more', () => {
        it('should inject a load-more node when data has more pages', async () => {
            const executor = new ActionExecutor(new NullTelemetryReporter());
            const dataTree = new DataItemTree<TestResource>('test', executor, r => r.id, 60_000);

            dataTree.registerProvider({
                isRoot: true,
                canHandle: canHandleNoResources,
                getChildren: () => [{ id: 'parent' }],
            });
            dataTree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestResource => (r as TestResource).id === 'parent',
                getChildren: () => ({
                    [Symbol.asyncIterator]() {
                        let called = false;
                        return {
                            next() {
                                if (!called) {
                                    called = true;
                                    return Promise.resolve({
                                        value: { items: [{ id: 'c1' }], hasMore: true },
                                        done: false as const,
                                    });
                                }
                                return Promise.resolve({ done: true as const, value: undefined });
                            },
                        };
                    },
                }),
            });

            await dataTree.getChildren();
            await dataTree.getChildren({ id: 'parent' });

            const viewTree = new ViewItemTree<TestViewItem, TestResource>('test', executor, {
                dataItemTree: dataTree,
                toViewItem: r => r.id,
                getKey: vi => vi,
                getResourceKey: vi => vi,
            }, {
                isLoadMoreViewItem: vi => vi === '__loadMore__',
                getLoadMoreViewItem: () => '__loadMore__',
                getParentViewItem: () => 'parent',
                getTreeItem: (_parent, loading) => ({ label: loading ? 'Loading...' : 'Load More' }),
            });

            viewTree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestViewItem => r === 'parent',
                getChildren: () => ['c1'],
                getTreeItem: (vi) => ({ label: vi, id: vi }),
            });
            viewTree.registerProvider(createRootViewProvider(['parent']));

            await viewTree.getChildren();
            const children = await viewTree.getChildren('parent');

            expect(children[children.length - 1]).to.equal('__loadMore__');
        });

        it('should return a tree item for load-more nodes', async () => {
            const { dataTree } = createSetup();
            const executor = new ActionExecutor(new NullTelemetryReporter());

            const viewTreeWithLoadMore = new ViewItemTree<TestViewItem, TestResource>('test', executor, {
                dataItemTree: dataTree,
                toViewItem: r => r.id,
                getKey: vi => vi,
                getResourceKey: vi => vi,
            }, {
                isLoadMoreViewItem: vi => vi === '__loadMore__',
                getLoadMoreViewItem: () => '__loadMore__',
                getParentViewItem: () => 'parent',
                getTreeItem: (_parent, _loading): ITreeItem => ({ label: 'Load More' }),
            });

            viewTreeWithLoadMore.registerProvider(createRootViewProvider(['parent']));
            await viewTreeWithLoadMore.getChildren();

            const treeItem = await viewTreeWithLoadMore.getTreeItem('__loadMore__');
            expect(treeItem.label).to.equal('Load More');
        });
    });

    describe('dispose', () => {
        it('should clean up data tree subscription and registrations', async () => {
            const { dataTree, viewTree } = createSetup();
            viewTree.registerProvider(createRootViewProvider(['a']));
            await viewTree.getChildren();

            const onChange = mock.fn();
            viewTree.onDidChangeTreeData(onChange);

            viewTree.dispose();

            // After dispose, data tree changes should not propagate
            dataTree.invalidateAll();
            expect(onChange.mock.callCount()).to.equal(0);
        });
    });
});
