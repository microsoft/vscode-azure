/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { mock } from 'node:test';
import { delay } from '../../base/delay';
import type { Page } from '../../data/Page';
import { DataItemTree } from '../../tree/DataItemTree';
import type { DataProvider, DataProviderChangeEvent } from '../../tree/DataProvider';
import { Everything, Roots, selfOnly, subtreeOf } from '../../tree/Selector';
import { createTestActionExecutor } from '../createTestActionExecutor';
import { createMockVsCode } from '../vscode/MockVsCode';

interface TestResource {
    id: string;
    enriched?: boolean;
}

const canHandleAll = (_r: unknown): _r is TestResource => true;
const canHandleNone = (_r: unknown): _r is TestResource => false;

function createTree(ttl = 60_000) {
    const { executor } = createTestActionExecutor();
    const { vscode } = createMockVsCode();
    return new DataItemTree<TestResource>(vscode, 'test', executor, r => r.id, ttl);
}

function createRootProvider(children: TestResource[]): DataProvider<TestResource> {
    return {
        isRoot: true,
        canHandle: canHandleNone,
        getChildren: () => children,
    };
}

function createBranchProvider(
    childMap: Map<string, TestResource[]>,
    options?: { enrich?: (r: TestResource) => Promise<boolean> },
): DataProvider<TestResource> {
    return {
        isRoot: false,
        canHandle: (r: unknown): r is TestResource => childMap.has((r as TestResource).id),
        getChildren: (r?: TestResource) => r ? (childMap.get(r.id) ?? []) : [],
        enrich: options?.enrich,
    };
}

describe('DataItemTree (unit)', () => {
    describe('getChildren (roots)', () => {
        it('should return children from registered root providers', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'a' }, { id: 'b' }]));

            const children = await tree.getChildren();
            expect(children.map(c => c.id)).to.deep.equal(['a', 'b']);
        });

        it('should merge children from multiple root providers', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'a' }]));
            tree.registerProvider(createRootProvider([{ id: 'b' }]));

            const children = await tree.getChildren();
            expect(children.map(c => c.id)).to.deep.equal(['a', 'b']);
        });

        it('should cache root children within TTL', async () => {
            const tree = createTree();
            const fn = mock.fn(() => [{ id: 'a' }]);
            tree.registerProvider({ isRoot: true, canHandle: canHandleNone, getChildren: fn });

            await tree.getChildren();
            await tree.getChildren();

            expect(fn.mock.callCount()).to.equal(1);
        });

        it('should re-fetch after TTL expires', async () => {
            const tree = createTree(0); // TTL = 0 -> always stale
            const fn = mock.fn(() => [{ id: 'a' }]);
            tree.registerProvider({ isRoot: true, canHandle: canHandleNone, getChildren: fn });

            await tree.getChildren();
            await tree.getChildren();

            expect(fn.mock.callCount()).to.equal(2);
        });
    });

    describe('getChildren (branches)', () => {
        it('should return children for a known resource', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'root' }]));
            tree.registerProvider(createBranchProvider(new Map([['root', [{ id: 'child1' }, { id: 'child2' }]]])));

            await tree.getChildren(); // load roots
            const children = await tree.getChildren({ id: 'root' });
            expect(children.map(c => c.id)).to.deep.equal(['child1', 'child2']);
        });

        it('should return empty array when no provider matches', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'root' }]));

            await tree.getChildren(); // load roots
            const children = await tree.getChildren({ id: 'root' });
            expect(children).to.deep.equal([]);
        });

        it('should cache branch children within TTL', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'root' }]));
            const fn = mock.fn(() => [{ id: 'child' }]);
            tree.registerProvider({ isRoot: false, canHandle: canHandleAll, getChildren: fn });

            await tree.getChildren();
            await tree.getChildren({ id: 'root' });
            await tree.getChildren({ id: 'root' });

            expect(fn.mock.callCount()).to.equal(1);
        });

        it('should throw for resources not in the tree', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'root' }]));
            await tree.getChildren();

            try {
                await tree.getChildren({ id: 'unknown' });
                expect.fail('Expected error');
            } catch (e) {
                expect((e as Error).message).to.include('not found');
            }
        });
    });

    describe('getTtl', () => {
        it('should honor a provider getTtl over the tree default for root children', async () => {
            const tree = createTree(0); // default TTL = 0 -> always stale
            const fn = mock.fn(() => [{ id: 'a' }]);
            tree.registerProvider({
                isRoot: true,
                canHandle: canHandleNone,
                getChildren: fn,
                getTtl: () => Infinity, // never stale
            });

            await tree.getChildren();
            await tree.getChildren();

            expect(fn.mock.callCount()).to.equal(1);
        });

        it('should honor a provider getTtl over the tree default for branch children', async () => {
            const tree = createTree(0); // default TTL = 0 -> always stale
            tree.registerProvider(createRootProvider([{ id: 'root' }]));
            const fn = mock.fn(() => [{ id: 'child' }]);
            tree.registerProvider({
                isRoot: false,
                canHandle: canHandleAll,
                getChildren: fn,
                getTtl: () => Infinity,
            });

            await tree.getChildren();
            await tree.getChildren({ id: 'root' });
            await tree.getChildren({ id: 'root' });

            expect(fn.mock.callCount()).to.equal(1);
        });

        it('should fall back to the tree default TTL when getTtl is absent', async () => {
            const tree = createTree(0); // default TTL = 0 -> always stale
            const fn = mock.fn(() => [{ id: 'a' }]);
            tree.registerProvider({ isRoot: true, canHandle: canHandleNone, getChildren: fn });

            await tree.getChildren();
            await tree.getChildren();

            expect(fn.mock.callCount()).to.equal(2);
        });

        it('should still re-fetch infinite-TTL children after explicit invalidation', async () => {
            const tree = createTree(0);
            const fn = mock.fn(() => [{ id: 'a' }]);
            tree.registerProvider({
                isRoot: true,
                canHandle: canHandleNone,
                getChildren: fn,
                getTtl: () => Infinity,
            });

            await tree.getChildren();
            tree.invalidate(Everything);
            await tree.getChildren();

            expect(fn.mock.callCount()).to.equal(2);
        });
    });

    describe('get', () => {
        it('should return a resource by key after loading', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'a' }]));

            await tree.getChildren();
            expect(tree.get('a')).to.deep.equal({ id: 'a' });
        });

        it('should return undefined for unknown keys', () => {
            const tree = createTree();
            expect(tree.get('nope')).to.be.undefined;
        });
    });

    describe('pagination', () => {
        function createPagedProvider(parentId: string, pages: Page<TestResource>[]): DataProvider<TestResource> {
            return {
                isRoot: false,
                canHandle: (r: unknown): r is TestResource => (r as TestResource).id === parentId,
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

        it('should load the first page on getChildren', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'root' }]));
            tree.registerProvider(createPagedProvider('root', [
                { items: [{ id: 'p1a' }, { id: 'p1b' }], hasMore: true },
                { items: [{ id: 'p2a' }], hasMore: false },
            ]));

            await tree.getChildren();
            const children = await tree.getChildren({ id: 'root' });

            expect(children.map(c => c.id)).to.deep.equal(['p1a', 'p1b']);
            expect(tree.hasMore({ id: 'root' })).to.be.true;
        });

        it('should append the second page on loadMore', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'root' }]));
            tree.registerProvider(createPagedProvider('root', [
                { items: [{ id: 'p1a' }], hasMore: true },
                { items: [{ id: 'p2a' }], hasMore: false },
            ]));

            await tree.getChildren();
            await tree.getChildren({ id: 'root' });

            await tree.loadMore({ id: 'root' });

            const children = await tree.getChildren({ id: 'root' });
            expect(children.map(c => c.id)).to.deep.equal(['p1a', 'p2a']);
            expect(tree.hasMore({ id: 'root' })).to.be.false;
        });

        it('should load all pages with loadAll', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'root' }]));
            tree.registerProvider(createPagedProvider('root', [
                { items: [{ id: 'a' }], hasMore: true },
                { items: [{ id: 'b' }], hasMore: true },
                { items: [{ id: 'c' }], hasMore: false },
            ]));

            await tree.getChildren();
            await tree.loadAll({ id: 'root' });

            const children = await tree.getChildren({ id: 'root' });
            expect(children.map(c => c.id)).to.deep.equal(['a', 'b', 'c']);
            expect(tree.hasMore({ id: 'root' })).to.be.false;
        });

        it('should return false for hasMore at root level', () => {
            const tree = createTree();
            expect(tree.hasMore()).to.be.false;
        });

        it('should wipe cached children and pagination state when no provider matches on refresh', async () => {
            const tree = createTree(0);
            let canHandleRoot = true;
            tree.registerProvider(createRootProvider([{ id: 'root' }]));
            tree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestResource => canHandleRoot && (r as TestResource).id === 'root',
                getChildren: () => {
                    const iter = [
                        { items: [{ id: 'p1' }], hasMore: true },
                        { items: [{ id: 'p2' }], hasMore: false },
                    ][Symbol.iterator]();
                    return {
                        [Symbol.asyncIterator]() {
                            return { next: () => Promise.resolve(iter.next()) };
                        },
                    };
                },
            });

            await tree.getChildren();
            const firstPage = await tree.getChildren({ id: 'root' });
            expect(firstPage.map(c => c.id)).to.deep.equal(['p1']);
            expect(tree.get('p1')).to.not.be.undefined;
            expect(tree.hasMore({ id: 'root' })).to.be.true;

            canHandleRoot = false;
            const refreshed = await tree.getChildren({ id: 'root' });

            expect(refreshed).to.deep.equal([]);
            expect(tree.get('p1')).to.be.undefined;
            expect(tree.hasMore({ id: 'root' })).to.be.false;
        });
    });

    describe('enrichment', () => {
        it('should run enrich on loaded resources', async () => {
            const tree = createTree();
            const enriched: string[] = [];
            tree.registerProvider({
                isRoot: true,
                canHandle: canHandleAll,
                getChildren: () => [{ id: 'a' }, { id: 'b' }],
                enrich: (r: TestResource) => {
                    enriched.push(r.id);
                    r.enriched = true;
                    return Promise.resolve(false);
                },
            });

            await tree.getChildren();
            // Wait for background enrichment
            await tree.whenEnriched(tree.get('a')!);
            await tree.whenEnriched(tree.get('b')!);

            expect(enriched).to.include('a');
            expect(enriched).to.include('b');
        });

        it('should resolve immediately when no enrich provider matches', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'a' }]));

            await tree.getChildren();
            const result = await tree.whenEnriched(tree.get('a')!);
            expect(result.id).to.equal('a');
        });
    });

    describe('invalidation', () => {
        it('should re-fetch children after invalidate', async () => {
            const tree = createTree();
            const fn = mock.fn(() => [{ id: 'child' }]);
            tree.registerProvider(createRootProvider([{ id: 'root' }]));
            tree.registerProvider({ isRoot: false, canHandle: canHandleAll, getChildren: fn });

            await tree.getChildren();
            await tree.getChildren({ id: 'root' });

            tree.invalidate({ id: 'root' });
            await tree.getChildren({ id: 'root' });

            expect(fn.mock.callCount()).to.equal(2);
        });

        it('should not re-fetch when invalidating self only', async () => {
            const tree = createTree();
            const fn = mock.fn(() => [{ id: 'child' }]);
            tree.registerProvider(createRootProvider([{ id: 'root' }]));
            tree.registerProvider({ isRoot: false, canHandle: canHandleAll, getChildren: fn });

            await tree.getChildren();
            await tree.getChildren({ id: 'root' });

            tree.invalidate(selfOnly({ id: 'root' }));
            await tree.getChildren({ id: 'root' });

            // Children are still cached, so provider is called only once
            expect(fn.mock.callCount()).to.equal(1);
        });

        it('should fire onDidChange on invalidate', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'a' }]));
            await tree.getChildren();

            const onChange = mock.fn();
            tree.onDidChange(onChange);

            tree.invalidate({ id: 'a' });
            expect(onChange.mock.callCount()).to.equal(1);
        });

        it('should clear all caches on invalidate(Everything)', async () => {
            const tree = createTree();
            const fn = mock.fn(() => [{ id: 'root' }]);
            tree.registerProvider({ isRoot: true, canHandle: canHandleNone, getChildren: fn });

            await tree.getChildren();
            tree.invalidate(Everything);
            await tree.getChildren();

            expect(fn.mock.callCount()).to.equal(2);
        });

        it('should fire onDidChange with undefined on invalidate(Everything)', () => {
            const tree = createTree();
            const onChange = mock.fn();
            tree.onDidChange(onChange);

            tree.invalidate(Everything);
            expect(onChange.mock.callCount()).to.equal(1);
            expect(onChange.mock.calls[0].arguments[0]).to.be.undefined;
        });
    });

    describe('target input forms', () => {
        it('should invalidate a subtree when given a bare string key', async () => {
            const tree = createTree();
            const fn = mock.fn(() => [{ id: 'child' }]);
            tree.registerProvider(createRootProvider([{ id: 'root' }]));
            tree.registerProvider({ isRoot: false, canHandle: canHandleAll, getChildren: fn });

            await tree.getChildren();
            await tree.getChildren({ id: 'root' });

            const onChange = mock.fn();
            tree.onDidChange(onChange);

            tree.invalidate('root');
            await tree.getChildren({ id: 'root' });

            // Subtree was wiped, so children are re-fetched, and the loaded node fires.
            expect(fn.mock.callCount()).to.equal(2);
            expect(onChange.mock.callCount()).to.equal(1);
            expect((onChange.mock.calls[0].arguments[0] as TestResource).id).to.equal('root');
        });

        it('should invalidate every entry when given an array of resources/keys', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'a' }, { id: 'b' }, { id: 'c' }]));
            tree.registerProvider(createBranchProvider(new Map([
                ['a', [{ id: 'a-child' }]],
                ['b', [{ id: 'b-child' }]],
            ])));

            await tree.getChildren();
            await tree.getChildren({ id: 'a' });
            await tree.getChildren({ id: 'b' });

            const onChange = mock.fn();
            tree.onDidChange(onChange);

            // Mixed array: a resource object and a bare key.
            tree.invalidate([{ id: 'a' }, 'b']);

            expect(tree.get('a-child')).to.be.undefined;
            expect(tree.get('b-child')).to.be.undefined;
            expect(onChange.mock.callCount()).to.equal(2);
            expect((onChange.mock.calls.map(c => (c.arguments[0] as TestResource).id))).to.have.members(['a', 'b']);
        });

        it('should wipe the subtree for an explicit subtreeOf descriptor', async () => {
            const tree = createTree();
            const fn = mock.fn(() => [{ id: 'child' }]);
            tree.registerProvider(createRootProvider([{ id: 'root' }]));
            tree.registerProvider({ isRoot: false, canHandle: canHandleAll, getChildren: fn });

            await tree.getChildren();
            await tree.getChildren({ id: 'root' });

            tree.invalidate(subtreeOf({ id: 'root' }));
            await tree.getChildren({ id: 'root' });

            expect(fn.mock.callCount()).to.equal(2);
        });

        it('should remove nodes addressed by a bare string key', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'parent' }]));
            tree.registerProvider(createBranchProvider(new Map([
                ['parent', [{ id: 'keep' }, { id: 'drop' }]],
            ])));

            await tree.getChildren();
            await tree.getChildren({ id: 'parent' });

            tree.remove('drop');

            expect(tree.get('drop')).to.be.undefined;
            expect(tree.get('keep')).to.not.be.undefined;
        });

        it('should remove nodes addressed by an array', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'parent' }]));
            tree.registerProvider(createBranchProvider(new Map([
                ['parent', [{ id: 'keep' }, { id: 'drop-1' }, { id: 'drop-2' }]],
            ])));

            await tree.getChildren();
            await tree.getChildren({ id: 'parent' });

            tree.remove([{ id: 'drop-1' }, 'drop-2']);

            expect(tree.get('drop-1')).to.be.undefined;
            expect(tree.get('drop-2')).to.be.undefined;
            expect(tree.get('keep')).to.not.be.undefined;
        });

        it('should throw when remove is given the Everything or Roots sentinel', () => {
            const tree = createTree();
            expect(() => { tree.remove(Everything); }).to.throw();
            expect(() => { tree.remove(Roots); }).to.throw();
        });
    });

    describe('selector-based targeting', () => {
        it('should wipe the subtree of every node matched by a subtree selector and fire at the apex', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'a' }, { id: 'b' }]));
            tree.registerProvider(createBranchProvider(new Map([
                ['a', [{ id: 'a-child' }]],
                ['b', [{ id: 'b-child' }]],
            ])));

            await tree.getChildren();
            await tree.getChildren({ id: 'a' });
            await tree.getChildren({ id: 'b' });

            const onChange = mock.fn();
            tree.onDidChange(onChange);

            tree.invalidate((r: TestResource) => r.id === 'a' ? 'subtree' : undefined);

            // Only 'a' subtree is evicted; 'b' is untouched.
            expect(tree.get('a-child')).to.be.undefined;
            expect(tree.get('b-child')).to.not.be.undefined;
            expect(onChange.mock.callCount()).to.equal(1);
            expect((onChange.mock.calls[0].arguments[0] as TestResource).id).to.equal('a');
        });

        it('should stop descending past a subtree match (no double-fire for nested matches)', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'a' }]));
            tree.registerProvider(createBranchProvider(new Map([
                ['a', [{ id: 'a-child' }]],
            ])));

            await tree.getChildren();
            await tree.getChildren({ id: 'a' });

            const onChange = mock.fn();
            tree.onDidChange(onChange);

            // Both 'a' and its descendant would match, but the apex absorbs the subtree.
            tree.invalidate((r: TestResource) => r.id.startsWith('a') ? 'subtree' : undefined);

            expect(onChange.mock.callCount()).to.equal(1);
            expect((onChange.mock.calls[0].arguments[0] as TestResource).id).to.equal('a');
        });

        it('should keep children cached for a self selector', async () => {
            const tree = createTree();
            const fn = mock.fn(() => [{ id: 'child' }]);
            tree.registerProvider(createRootProvider([{ id: 'root' }]));
            tree.registerProvider({ isRoot: false, canHandle: canHandleAll, getChildren: fn });

            await tree.getChildren();
            await tree.getChildren({ id: 'root' });

            tree.invalidate((r: TestResource) => r.id === 'root' ? 'self' : undefined);
            await tree.getChildren({ id: 'root' });

            // 'self' preserves cached children, so the provider is not called again.
            expect(fn.mock.callCount()).to.equal(1);
        });

        it('should remove every node matched by a selector', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'parent' }]));
            tree.registerProvider(createBranchProvider(new Map([
                ['parent', [{ id: 'keep' }, { id: 'drop-1' }, { id: 'drop-2' }]],
            ])));

            await tree.getChildren();
            await tree.getChildren({ id: 'parent' });

            tree.remove((r: TestResource) => r.id.startsWith('drop') ? 'subtree' : undefined);

            expect(tree.get('drop-1')).to.be.undefined;
            expect(tree.get('drop-2')).to.be.undefined;
            expect(tree.get('keep')).to.not.be.undefined;
        });

        it('should be a no-op when a selector matches nothing', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'a' }]));
            await tree.getChildren();

            const onChange = mock.fn();
            tree.onDidChange(onChange);

            tree.invalidate((_r: TestResource) => undefined);
            tree.remove((_r: TestResource) => undefined);

            expect(onChange.mock.callCount()).to.equal(0);
        });
    });

    describe('provider change events', () => {
        it('should invalidate when provider fires onDidChange for a resource', async () => {
            const tree = createTree();
            let fireChange!: (event: DataProviderChangeEvent<TestResource>) => void;
            const provider: DataProvider<TestResource> = {
                isRoot: true,
                canHandle: canHandleAll,
                getChildren: () => [{ id: 'a' }],
                onDidChange: (listener) => {
                    fireChange = listener;
                    return { dispose: () => { /* noop */ } };
                },
            };
            tree.registerProvider(provider);

            const onChange = mock.fn();
            tree.onDidChange(onChange);

            await tree.getChildren();
            fireChange({ target: { id: 'a' } });

            expect(onChange.mock.callCount()).to.be.greaterThan(0);
        });

        it('should invalidate(Everything) when provider fires onDidChange with undefined resource', async () => {
            const tree = createTree();
            let fireChange!: (event: DataProviderChangeEvent<TestResource>) => void;
            const provider: DataProvider<TestResource> = {
                isRoot: true,
                canHandle: canHandleAll,
                getChildren: () => [{ id: 'a' }],
                onDidChange: (listener) => {
                    fireChange = listener;
                    return { dispose: () => { /* noop */ } };
                },
            };
            tree.registerProvider(provider);
            await tree.getChildren();

            fireChange({ target: Everything });

            // After invalidate(Everything), get('a') should be undefined
            expect(tree.get('a')).to.be.undefined;
        });
    });

    describe('remove', () => {
        it('should remove a branch child without evicting siblings', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'parent' }]));
            tree.registerProvider(createBranchProvider(
                new Map([['parent', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]]]),
            ));

            await tree.getChildren();
            await tree.getChildren({ id: 'parent' });

            tree.remove({ id: 'b' });

            expect(tree.get('b')).to.be.undefined;
            expect(tree.get('a')).to.not.be.undefined;
            expect(tree.get('c')).to.not.be.undefined;
        });

        it('should fire onDidChange for the parent when removing a branch child', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'parent' }]));
            tree.registerProvider(createBranchProvider(
                new Map([['parent', [{ id: 'child' }]]]),
            ));

            await tree.getChildren();
            await tree.getChildren({ id: 'parent' });

            const onChange = mock.fn();
            tree.onDidChange(onChange);

            tree.remove({ id: 'child' });

            expect(onChange.mock.callCount()).to.equal(1);
            expect((onChange.mock.calls[0].arguments[0] as TestResource).id).to.equal('parent');
        });

        it('should evict descendants of the removed item', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'root' }]));
            tree.registerProvider(createBranchProvider(
                new Map([
                    ['root', [{ id: 'child' }]],
                    ['child', [{ id: 'grandchild' }]],
                ]),
            ));

            await tree.getChildren();
            await tree.getChildren({ id: 'root' });
            await tree.getChildren({ id: 'child' });

            expect(tree.get('grandchild')).to.not.be.undefined;

            tree.remove({ id: 'child' });

            expect(tree.get('child')).to.be.undefined;
            expect(tree.get('grandchild')).to.be.undefined;
        });

        it('should remove a root item and fire undefined (full refresh)', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'r1' }, { id: 'r2' }]));
            await tree.getChildren();

            const onChange = mock.fn();
            tree.onDidChange(onChange);

            tree.remove({ id: 'r1' });

            expect(tree.get('r1')).to.be.undefined;
            expect(tree.get('r2')).to.not.be.undefined;

            expect(onChange.mock.callCount()).to.equal(1);
            expect(onChange.mock.calls[0].arguments[0]).to.be.undefined;
        });

        it('should not re-fetch sibling children after removal', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'parent' }]));
            tree.registerProvider(createBranchProvider(
                new Map([['parent', [{ id: 'keep' }, { id: 'remove' }]]]),
            ));

            const siblingFetch = mock.fn(() => [{ id: 'leaf' }]);
            tree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestResource => (r as TestResource).id === 'keep',
                getChildren: siblingFetch,
            });

            await tree.getChildren();
            await tree.getChildren({ id: 'parent' });
            await tree.getChildren({ id: 'keep' });
            expect(siblingFetch.mock.callCount()).to.equal(1);

            tree.remove({ id: 'remove' });

            await tree.getChildren({ id: 'keep' });
            expect(siblingFetch.mock.callCount()).to.equal(1);
        });

        it('should be a no-op when the item is not in the cache', () => {
            const tree = createTree();

            const onChange = mock.fn();
            tree.onDidChange(onChange);

            tree.remove({ id: 'nonexistent' });

            expect(onChange.mock.callCount()).to.equal(0);
        });

        it('should update getChildren result for the parent after removal', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'parent' }]));
            tree.registerProvider(createBranchProvider(
                new Map([['parent', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]]]),
            ));

            await tree.getChildren();
            await tree.getChildren({ id: 'parent' });

            tree.remove({ id: 'b' });

            const children = await tree.getChildren({ id: 'parent' });
            expect(children.map(c => c.id)).to.deep.equal(['a', 'c']);
        });

        it('should not fire spurious change event when enrichment resolves after removal', async () => {
            const tree = createTree();

            const { promise: enrichPromise, resolve: resolveEnrichInner } = Promise.withResolvers<boolean>();
            const resolveEnrich = () => { resolveEnrichInner(false); };
            tree.registerProvider({
                isRoot: true,
                canHandle: canHandleAll,
                getChildren: () => [{ id: 'item' }],
                enrich: () => enrichPromise,
            });

            await tree.getChildren();

            // Remove the item while enrichment is still in flight
            tree.remove({ id: 'item' });

            const onChange = mock.fn();
            tree.onDidChange(onChange);

            // Now let enrichment resolve -- should be a no-op
            resolveEnrich();
            await delay(10);

            expect(onChange.mock.callCount()).to.equal(0);
        });

        it('should not re-insert children when loadMore resolves after removal', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'parent' }]));

            const { promise: pagePromise, resolve: resolvePage } = Promise.withResolvers<IteratorResult<Page<TestResource>>>();
            const resolveNextPage = () => {
                resolvePage({
                    done: false,
                    value: { items: [{ id: 'orphan' }], hasMore: false },
                });
            };

            tree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestResource => (r as TestResource).id === 'parent',
                getChildren: () => ({
                    [Symbol.asyncIterator]() {
                        let firstPage = true;
                        return {
                            next() {
                                if (firstPage) {
                                    firstPage = false;
                                    return Promise.resolve<IteratorResult<Page<TestResource>>>({
                                        done: false,
                                        value: { items: [{ id: 'p1' }], hasMore: true },
                                    });
                                }
                                return pagePromise;
                            },
                        };
                    },
                }),
            });

            await tree.getChildren();
            await tree.getChildren({ id: 'parent' });
            expect(tree.hasMore({ id: 'parent' })).to.be.true;

            // Start loading the next page (awaits the deferred promise)
            const loadPromise = tree.loadMore({ id: 'parent' });

            // Remove the parent while page load is in flight
            tree.remove({ id: 'parent' });

            // Resolve the page -- should be discarded
            resolveNextPage();
            await loadPromise;

            expect(tree.get('orphan')).to.be.undefined;
        });

        it('should discard an in-flight page when the subtree is invalidated mid-load (iterator-identity guard)', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'parent' }]));

            const { promise: pagePromise, resolve: resolvePage } = Promise.withResolvers<IteratorResult<Page<TestResource>>>();
            const resolveNextPage = () => {
                resolvePage({
                    done: false,
                    value: { items: [{ id: 'orphan' }], hasMore: false },
                });
            };

            tree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestResource => (r as TestResource).id === 'parent',
                getChildren: () => ({
                    [Symbol.asyncIterator]() {
                        let firstPage = true;
                        return {
                            next() {
                                if (firstPage) {
                                    firstPage = false;
                                    return Promise.resolve<IteratorResult<Page<TestResource>>>({
                                        done: false,
                                        value: { items: [{ id: 'p1' }], hasMore: true },
                                    });
                                }
                                return pagePromise;
                            },
                        };
                    },
                }),
            });

            await tree.getChildren();
            await tree.getChildren({ id: 'parent' });
            expect(tree.hasMore({ id: 'parent' })).to.be.true;

            // Start loading the next page (awaits the deferred promise)
            const loadPromise = tree.loadMore({ id: 'parent' });

            // Invalidate the parent's subtree while the page load is in flight.
            // Unlike remove(), this keeps the parent node (and its map entry), so
            // only the iterator reset done by wipeSubtree -- not the node-identity
            // check -- can catch the stale page.
            tree.invalidate(subtreeOf<TestResource>({ id: 'parent' }));

            // Resolve the page -- should be discarded because the captured
            // iterator is no longer the node's current iterator.
            resolveNextPage();
            await loadPromise;

            // The parent node survives, but the stale page's child must not have
            // been re-inserted into the cache.
            expect(tree.get('parent')).to.not.be.undefined;
            expect(tree.get('orphan')).to.be.undefined;
            expect(tree.get('p1')).to.be.undefined;
        });
    });

    describe('root reconciliation', () => {
        const handleIds = (...ids: string[]) =>
            (r: unknown): r is TestResource => ids.includes((r as TestResource).id);

        it('should reconcile roots on invalidate(Roots): preserve survivors, evict removed, fetch new lazily', async () => {
            const aChildren = mock.fn(() => [{ id: 'a-child' }]);
            const bChildren = mock.fn(() => [{ id: 'b-child' }]);
            const cChildren = mock.fn(() => [{ id: 'c-child' }]);
            const tree = createTree();
            let rootList: TestResource[] = [{ id: 'a' }, { id: 'b' }];
            tree.registerProvider({ isRoot: true, canHandle: handleIds('a', 'b', 'c'), getChildren: (r?: TestResource) => {
                if (!r) {
                    return rootList.map(x => ({ ...x }));
                }
                switch (r.id) {
                    case 'a': return aChildren();
                    case 'b': return bChildren();
                    case 'c': return cChildren();
                    default: return [];
                }
            } });

            await tree.getChildren();
            await tree.getChildren({ id: 'a' });
            await tree.getChildren({ id: 'b' });
            expect(aChildren.mock.callCount()).to.equal(1);
            expect(bChildren.mock.callCount()).to.equal(1);

            // New listing: 'a' survives, 'b' removed, 'c' is new.
            rootList = [{ id: 'a' }, { id: 'c' }];

            const onChange = mock.fn();
            tree.onDidChange(onChange);
            tree.invalidate(Roots);
            expect(onChange.mock.callCount()).to.equal(1);
            expect(onChange.mock.calls[0].arguments[0]).to.be.undefined;

            const roots = await tree.getChildren();
            expect(roots.map(r => r.id)).to.deep.equal(['a', 'c']);

            // Surviving root: children subtree preserved (no re-fetch).
            await tree.getChildren({ id: 'a' });
            expect(aChildren.mock.callCount()).to.equal(1);

            // Removed root: subtree fully evicted.
            expect(tree.get('b')).to.be.undefined;
            expect(tree.get('b-child')).to.be.undefined;

            // New root: children fetched lazily on first access.
            await tree.getChildren({ id: 'c' });
            expect(cChildren.mock.callCount()).to.equal(1);
        });

        it('should reconcile (not wipe) on a root change event targeting Roots', async () => {
            let fireChange!: (event: DataProviderChangeEvent<TestResource>) => void;
            let rootList: TestResource[] = [{ id: 'a' }, { id: 'b' }];
            const tree = createTree();
            const aChildren = mock.fn(() => [{ id: 'a-child' }]);
            tree.registerProvider({
                isRoot: true,
                canHandle: handleIds('a', 'b'),
                getChildren: (r?: TestResource) => (r ? (r.id === 'a' ? aChildren() : []) : rootList.map(x => ({ ...x }))),
                onDidChange: (listener) => { fireChange = listener; return { dispose: () => { /* noop */ } }; },
            });

            await tree.getChildren();
            await tree.getChildren({ id: 'a' });
            expect(aChildren.mock.callCount()).to.equal(1);

            rootList = [{ id: 'a' }];
            fireChange({ target: Roots });

            const roots = await tree.getChildren();
            expect(roots.map(r => r.id)).to.deep.equal(['a']);
            // Survivor's subtree preserved (reconcile, not full wipe).
            await tree.getChildren({ id: 'a' });
            expect(aChildren.mock.callCount()).to.equal(1);
        });

        it('should preserve a surviving root\'s full multi-level subtree (account -> tenant -> subscription)', async () => {
            // Mirrors the Azure account tree: an account (root) has tenants
            // (level 1) which have subscriptions (level 2). A reconciling root
            // re-list after a session change must keep the cached -- and
            // expensive to rebuild -- tenant/subscription subtrees under accounts
            // that are still signed in.
            const tenantChildren = mock.fn(() => [{ id: 'tenant' }]);
            const subscriptionChildren = mock.fn(() => [{ id: 'subscription' }]);
            const tree = createTree();
            let rootList: TestResource[] = [{ id: 'account' }, { id: 'other-account' }];
            tree.registerProvider({
                isRoot: true,
                canHandle: handleIds('account', 'other-account', 'tenant', 'subscription'),
                getChildren: (r?: TestResource) => {
                    if (!r) {
                        return rootList.map(x => ({ ...x }));
                    }
                    switch (r.id) {
                        case 'account': return tenantChildren();
                        case 'tenant': return subscriptionChildren();
                        default: return [];
                    }
                },
            });

            // Load the full account -> tenant -> subscription chain.
            await tree.getChildren();
            await tree.getChildren({ id: 'account' });
            await tree.getChildren({ id: 'tenant' });
            expect(tenantChildren.mock.callCount()).to.equal(1);
            expect(subscriptionChildren.mock.callCount()).to.equal(1);

            // A session change removes the other account but keeps 'account'.
            rootList = [{ id: 'account' }];
            tree.invalidate(Roots);

            const roots = await tree.getChildren();
            expect(roots.map(r => r.id)).to.deep.equal(['account']);

            // Neither the tenant level nor the deeper subscription level is
            // re-fetched -- both cached nodes survive the reconcile.
            await tree.getChildren({ id: 'account' });
            await tree.getChildren({ id: 'tenant' });
            expect(tenantChildren.mock.callCount()).to.equal(1);
            expect(subscriptionChildren.mock.callCount()).to.equal(1);
            expect(tree.get('tenant')).to.not.be.undefined;
            expect(tree.get('subscription')).to.not.be.undefined;
        });
    });
});
