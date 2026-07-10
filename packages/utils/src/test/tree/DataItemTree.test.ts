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
import { Everything, Roots, selfOnly, subtreeOf, type Selector } from '../../tree/Selector';
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

/**
 * Cross-store consistency harness. `DataItemTree` keeps several stores that must
 * stay in agreement as nodes are loaded, invalidated, and removed:
 *   - `nodes` (a `NodeMap`, key -> node index),
 *   - the pointer tree (`roots` + each node's `children` / `parent`),
 *   - `enrichmentPromises` and `loadsInFlight` side tables,
 *   - per-node `pageIterator` pagers.
 *
 * These tests reach past `private` with a single unchecked cast (see
 * {@linkcode DataItemTreeInternals}) and assert a set of invariants after every
 * operation, including a randomized, seeded op-sequence so failures reproduce.
 */
describe('DataItemTree consistency (unit)', () => {
    // ---- fixtures -----------------------------------------------------------

    const CHILD_MAP = new Map<string, TestResource[]>([
        ['a', [{ id: 'a1' }, { id: 'a2' }]],
        ['a1', [{ id: 'a1x' }, { id: 'a1y' }]],
        ['a2', [{ id: 'a2x' }]],
        ['b', [{ id: 'b1' }]],
        ['b1', [{ id: 'b1x' }]],
    ]);
    const CONSISTENCY_ROOTS: TestResource[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

    // Every id that can appear anywhere in the CHILD_MAP tree; used as the pool
    // of key-based targets for the randomized op-sequence (targets that are not
    // currently loaded are valid no-ops).
    const ALL_IDS = ['a', 'b', 'c', 'a1', 'a2', 'a1x', 'a1y', 'a2x', 'b1', 'b1x'];
    const PREFIXES = ['a', 'b', 'c', 'a1', 'a2', 'b1'];

    function buildTree(options?: { enrich?: boolean }): DataItemTree<TestResource> {
        const { executor } = createTestActionExecutor();
        const { vscode } = createMockVsCode();
        const tree = new DataItemTree<TestResource>(vscode, 'consistency', executor, r => r.id, 60_000);
        tree.registerProvider({
            isRoot: true,
            canHandle: canHandleNone,
            getChildren: () => CONSISTENCY_ROOTS.map(r => ({ ...r })),
        });
        const branch: DataProvider<TestResource> = {
            isRoot: false,
            canHandle: (r: unknown): r is TestResource => CHILD_MAP.has((r as TestResource).id),
            getChildren: (r?: TestResource) => (r ? (CHILD_MAP.get(r.id) ?? []).map(c => ({ ...c })) : []),
            enrich: options?.enrich
                ? async (r: TestResource): Promise<boolean> => { await delay(1); r.enriched = true; return false; }
                : undefined,
        };
        tree.registerProvider(branch);
        return tree;
    }

    // A tree whose root set can shrink between listings, to exercise the
    // reconcileRoots (mass root departure) path. Each root `rN` has one child `rNc`.
    function buildShrinkableRootTree(): { tree: DataItemTree<TestResource>; setRoots: (roots: TestResource[]) => void } {
        const roots = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}` }));
        const childMap = new Map(roots.map(r => [r.id, [{ id: `${r.id}c` }]]));
        let current = [...roots];
        const { executor } = createTestActionExecutor();
        const { vscode } = createMockVsCode();
        const tree = new DataItemTree<TestResource>(vscode, 'consistency-roots', executor, r => r.id, 60_000);
        tree.registerProvider({ isRoot: true, canHandle: canHandleNone, getChildren: () => current.map(r => ({ ...r })) });
        tree.registerProvider({
            isRoot: false,
            canHandle: (r: unknown): r is TestResource => childMap.has((r as TestResource).id),
            getChildren: (r?: TestResource) => (r ? (childMap.get(r.id) ?? []).map(c => ({ ...c })) : []),
        });
        return { tree, setRoots: (next: TestResource[]) => { current = next; } };
    }

    // A paged branch: root -> p1 (hasMore) -> p2 (done). A fresh iterator is
    // created on every listing so the pager can be re-installed after teardown.
    function buildPagedTree(): DataItemTree<TestResource> {
        const { executor } = createTestActionExecutor();
        const { vscode } = createMockVsCode();
        const tree = new DataItemTree<TestResource>(vscode, 'consistency-paged', executor, r => r.id, 60_000);
        tree.registerProvider({ isRoot: true, canHandle: canHandleNone, getChildren: () => [{ id: 'root' }] });
        tree.registerProvider({
            isRoot: false,
            canHandle: (r: unknown): r is TestResource => (r as TestResource).id === 'root',
            getChildren: () => {
                const pages: Page<TestResource>[] = [
                    { items: [{ id: 'p1' }], hasMore: true },
                    { items: [{ id: 'p2' }], hasMore: false },
                ];
                const iter = pages[Symbol.iterator]();
                return { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve(iter.next()) }) };
            },
        });
        return tree;
    }

    // Small, fast, seeded PRNG so a failing seed reproduces deterministically.
    function mulberry32(seed: number): () => number {
        let a = seed;
        return () => {
            a |= 0;
            a = (a + 0x6d2b79f5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function makePrefixSelector(prefix: string): Selector<TestResource> {
        return (r: TestResource) => (r.id.startsWith(prefix) ? 'subtree' : undefined);
    }

    // ---- internals access ---------------------------------------------------

    interface TreeNodeLike {
        readonly resource: TestResource;
        children: TreeNodeLike[] | undefined;
        parent: TreeNodeLike | undefined;
        pageIterator?: unknown;
    }

    interface DataItemTreeInternals {
        readonly nodes: { map: Map<string, TreeNodeLike> };
        readonly enrichmentPromises: ReadonlyMap<string, unknown>;
        readonly loadsInFlight: { inflight: ReadonlyMap<string, unknown> };
        readonly roots: TreeNodeLike[] | undefined;
    }

    function internalsOf(tree: DataItemTree<TestResource>): DataItemTreeInternals {
        return tree as unknown as DataItemTreeInternals;
    }

    // Fetch a resource that must currently be loaded, narrowing away `undefined`
    // without a cast or non-null assertion (both of which the linter rejects).
    function requireLoaded(tree: DataItemTree<TestResource>, key: string): TestResource {
        const resource = tree.get(key);
        if (resource === undefined) {
            throw new Error(`expected resource '${key}' to be loaded`);
        }
        return resource;
    }

    /**
     * Assert every cross-store invariant. `label` is prefixed to failure
     * messages so a failing randomized seed/step is identifiable.
     */
    function assertConsistent(tree: DataItemTree<TestResource>, label: string): void {
        const int = internalsOf(tree);

        // Walk the pointer tree from the roots, collecting reachable nodes/keys
        // and checking parent-pointer integrity + key uniqueness along the way.
        const reachable = new Map<string, TreeNodeLike>();
        const walk = (node: TreeNodeLike, expectedParent: TreeNodeLike | undefined): void => {
            const key = node.resource.id;
            expect(reachable.has(key), `${label}: duplicate key '${key}' in reachable tree`).to.equal(false);
            expect(node.parent, `${label}: parent pointer mismatch for key '${key}'`).to.equal(expectedParent);
            reachable.set(key, node);
            for (const child of node.children ?? []) {
                walk(child, node);
            }
        };
        for (const root of int.roots ?? []) {
            walk(root, undefined);
        }

        const reachableKeys = new Set(reachable.keys());
        const indexKeys = new Set(int.nodes.map.keys());

        // Invariant 1: the index and the reachable set are exactly equal, and
        // for shared keys the node object identity matches (no stale duplicate).
        expect([...indexKeys].sort(), `${label}: index keys must equal reachable keys`)
            .to.deep.equal([...reachableKeys].sort());
        for (const [key, node] of reachable) {
            expect(int.nodes.map.get(key), `${label}: node identity mismatch for key '${key}'`).to.equal(node);
        }

        // Invariant 3: side tables never outlive their node.
        for (const key of int.enrichmentPromises.keys()) {
            expect(reachableKeys.has(key), `${label}: enrichmentPromises key '${key}' not indexed`).to.equal(true);
        }
        for (const key of int.loadsInFlight.inflight.keys()) {
            expect(reachableKeys.has(key), `${label}: loadsInFlight key '${key}' not indexed`).to.equal(true);
        }
        for (const [key, node] of reachable) {
            if (node.pageIterator !== undefined) {
                expect(reachableKeys.has(key), `${label}: pageIterator holder '${key}' not indexed`).to.equal(true);
            }
        }
    }

    const pickKey = (rand: () => number): string => ALL_IDS[Math.floor(rand() * ALL_IDS.length)];
    const pickPrefix = (rand: () => number): string => PREFIXES[Math.floor(rand() * PREFIXES.length)];

    // Pick a currently-indexed resource so getChildren() never throws
    // "Resource not found in tree" (branch lookups require an existing node).
    function pickIndexedResource(tree: DataItemTree<TestResource>, rand: () => number): TestResource | undefined {
        const nodes = [...internalsOf(tree).nodes.map.values()];
        if (nodes.length === 0) {
            return undefined;
        }
        return nodes[Math.floor(rand() * nodes.length)].resource;
    }

    type Op = (tree: DataItemTree<TestResource>, rand: () => number) => Promise<void> | void;

    const OPS: Op[] = [
        async (tree) => { await tree.getChildren(); },
        async (tree, rand) => { const r = pickIndexedResource(tree, rand); if (r) { await tree.getChildren(r); } },
        (tree, rand) => { tree.invalidate(pickKey(rand)); },
        (tree, rand) => { tree.invalidate(selfOnly<TestResource>(pickKey(rand))); },
        (tree, rand) => { tree.invalidate(subtreeOf<TestResource>(pickKey(rand))); },
        (tree, rand) => { tree.remove(pickKey(rand)); },
        (tree) => { tree.invalidate(Roots); },
        (tree, rand) => { tree.invalidate(makePrefixSelector(pickPrefix(rand))); },
        (tree, rand) => { tree.remove(makePrefixSelector(pickPrefix(rand))); },
        (tree) => { tree.invalidate(Everything); },
    ];

    // ---- randomized op-sequence --------------------------------------------

    describe('randomized op-sequence keeps every store consistent', () => {
        for (const enrich of [false, true]) {
            for (const seed of [1, 2, 7, 42, 1337, 99999]) {
                it(`seed=${seed} enrich=${enrich}`, async () => {
                    const tree = buildTree({ enrich });
                    const rand = mulberry32(seed);
                    // Prime the roots so the first ops have something to act on.
                    await tree.getChildren();

                    for (let step = 0; step < 80; step++) {
                        const op = OPS[Math.floor(rand() * OPS.length)];
                        await op(tree, rand);
                        assertConsistent(tree, `seed=${seed} enrich=${enrich} step=${step} (sync)`);
                        // Let any background enrichment settle, then re-check.
                        await delay(0);
                        assertConsistent(tree, `seed=${seed} enrich=${enrich} step=${step} (settled)`);
                    }

                    tree.dispose();
                });
            }
        }
    });

    // ---- targeted teardown scenarios ---------------------------------------

    it('invalidate(Everything) empties every store', async () => {
        const tree = buildTree({ enrich: true });
        await tree.getChildren();
        await tree.getChildren({ id: 'a' });
        await tree.getChildren({ id: 'a1' });
        await tree.getChildren({ id: 'b' });
        assertConsistent(tree, 'primed');

        tree.invalidate(Everything);

        const int = internalsOf(tree);
        expect(int.nodes.map.size).to.equal(0);
        expect(int.enrichmentPromises.size).to.equal(0);
        expect(int.loadsInFlight.inflight.size).to.equal(0);
        expect(int.roots).to.equal(undefined);
        assertConsistent(tree, 'after Everything');
        tree.dispose();
    });

    it('remove(subtreeOf(node)) drops the whole subtree while a sibling survives', async () => {
        const tree = buildTree();
        await tree.getChildren();
        await tree.getChildren({ id: 'a' });   // a -> a1, a2
        await tree.getChildren({ id: 'a1' });  // a1 -> a1x, a1y
        await tree.getChildren({ id: 'b' });   // b -> b1
        assertConsistent(tree, 'primed');

        tree.remove(subtreeOf<TestResource>({ id: 'a1' }));

        const int = internalsOf(tree);
        // Removed subtree gone from the index.
        expect(int.nodes.map.has('a1')).to.equal(false);
        expect(int.nodes.map.has('a1x')).to.equal(false);
        expect(int.nodes.map.has('a1y')).to.equal(false);
        // Sibling and the other loaded subtree are untouched.
        expect(int.nodes.map.has('a2')).to.equal(true);
        expect(tree.get('b')).to.not.equal(undefined);
        expect(tree.get('b1')).to.not.equal(undefined);
        assertConsistent(tree, 'after remove a1');
        tree.dispose();
    });

    it('reconcileRoots drops departed roots and their subtrees while a survivor is intact (mass departure)', async () => {
        const { tree, setRoots } = buildShrinkableRootTree();
        await tree.getChildren();
        for (let i = 0; i < 10; i++) {
            await tree.getChildren({ id: `r${i}` }); // load each root's subtree
        }
        assertConsistent(tree, 'primed 10 roots');

        // Collapse to a single survivor and re-list the roots.
        setRoots([{ id: 'r7' }]);
        tree.invalidate(Roots);
        await tree.getChildren();

        const int = internalsOf(tree);
        for (let i = 0; i < 10; i++) {
            if (i === 7) {
                continue;
            }
            expect(int.nodes.map.has(`r${i}`), `r${i} should be evicted`).to.equal(false);
            expect(int.nodes.map.has(`r${i}c`), `r${i}c should be evicted`).to.equal(false);
        }
        // Survivor and its (preserved, not re-fetched) subtree remain indexed.
        expect(int.nodes.map.has('r7')).to.equal(true);
        expect(int.nodes.map.has('r7c')).to.equal(true);
        assertConsistent(tree, 'after mass departure');
        tree.dispose();
    });

    it('removing a paged node clears its pager and drops it from every store', async () => {
        const tree = buildPagedTree();
        await tree.getChildren();
        const root = requireLoaded(tree, 'root');
        await tree.getChildren(root);

        // Pager is live: hasMore is true and a reachable node holds a pageIterator.
        expect(tree.hasMore(root)).to.equal(true);
        expect([...internalsOf(tree).nodes.map.values()].some(n => n.pageIterator !== undefined)).to.equal(true);
        assertConsistent(tree, 'paged primed');

        tree.remove(root);

        expect(tree.hasMore(root)).to.equal(false);
        expect(tree.get('root')).to.equal(undefined);
        expect([...internalsOf(tree).nodes.map.values()].some(n => n.pageIterator !== undefined)).to.equal(false);
        assertConsistent(tree, 'after remove paged node');
        tree.dispose();
    });

    it('invalidate(Everything) empties every store even with a live pager', async () => {
        const tree = buildPagedTree();
        await tree.getChildren();
        const root = requireLoaded(tree, 'root');
        await tree.getChildren(root);
        expect(tree.hasMore(root)).to.equal(true);

        tree.invalidate(Everything);

        const int = internalsOf(tree);
        expect(int.nodes.map.size).to.equal(0);
        expect(int.enrichmentPromises.size).to.equal(0);
        expect(int.loadsInFlight.inflight.size).to.equal(0);
        expect(int.roots).to.equal(undefined);
        expect(tree.hasMore(root)).to.equal(false);
        assertConsistent(tree, 'after Everything with live pager');
        tree.dispose();
    });
});
