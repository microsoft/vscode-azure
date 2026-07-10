/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import type { QueryClient } from '@tanstack/query-core';
import { mock } from 'node:test';
import { delay } from '../../src/base/delay';
import type { Page } from '../../src/data/Page';
import { DataItemTree } from '../../src/tree/DataItemTree';
import type { DataProvider, DataProviderChangeEvent } from '../../src/tree/DataProvider';
import { Everything, Roots, selfOnly, subtreeOf, type Selector } from '../../src/tree/Selector';
import type { TreeIndex } from '../../src/tree/TreeIndex';
import { createTestActionExecutor } from '../createTestActionExecutor';
import { describeLongRunning } from '../describeLongRunning';
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

        it('should not fire undefined for a self match subsumed by a subtree match', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'a' }]));
            tree.registerProvider(createBranchProvider(new Map([
                ['a', [{ id: 'a-child' }]],
            ])));

            await tree.getChildren();
            await tree.getChildren({ id: 'a' });

            const onChange = mock.fn();
            tree.onDidChange(onChange);

            tree.invalidate((r: TestResource) => {
                if (r.id === 'a') {
                    return 'subtree';
                }
                if (r.id === 'a-child') {
                    return 'self';
                }

                return undefined;
            });

            expect(onChange.mock.callCount()).to.equal(1);
            expect(onChange.mock.calls.some(c => c.arguments[0] === undefined)).to.be.false;
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

        it('should discard an in-flight page even when the provider reuses the same iterator instance across fetches', async () => {
            // Regression guard: the staleness token is the object identity of the
            // installed pager. If a (pathological) provider returns the SAME
            // iterator instance on every getChildren call, a re-fetch that races
            // an in-flight loadMore reuses that mid-stream iterator. Routing the
            // first-page pull through the same in-flight de-duplication as
            // loadMore collapses the two to one guarded pull, so the superseded
            // page is discarded instead of advancing the shared iterator again
            // and clobbering the freshly re-fetched node.
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'parent' }]));

            const { promise: page2, resolve: resolvePage2 } = Promise.withResolvers<Page<TestResource>>();
            let callN = 0;
            // A single, reused, self-referential async iterator instance.
            const shared: AsyncIterableIterator<Page<TestResource>> = {
                [Symbol.asyncIterator]() { return this; },
                next(): Promise<IteratorResult<Page<TestResource>>> {
                    callN++;
                    if (callN === 1) {
                        return Promise.resolve({ done: false, value: { items: [{ id: 'p1' }], hasMore: true } });
                    }
                    return page2.then((value) => ({ done: false, value }));
                },
            };

            tree.registerProvider({
                isRoot: false,
                canHandle: (r: unknown): r is TestResource => (r as TestResource).id === 'parent',
                getChildren: () => shared,
            });

            await tree.getChildren();
            await tree.getChildren({ id: 'parent' });
            expect(tree.hasMore({ id: 'parent' })).to.be.true;

            // Start page 2 (pending), wipe the subtree mid-flight, then re-fetch
            // (which re-installs the SAME underlying iterator instance).
            const loadPromise = tree.loadMore({ id: 'parent' });
            tree.invalidate(subtreeOf<TestResource>({ id: 'parent' }));
            const refetch = tree.getChildren({ id: 'parent' });

            resolvePage2({ items: [{ id: 'orphan' }], hasMore: false });
            const refetched = await refetch;
            await loadPromise;

            // The superseded page must not land in the freshly re-fetched node.
            expect(refetched.map(r => r.id)).to.not.include('orphan');
            expect(tree.get('orphan')).to.be.undefined;
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
            tree.registerProvider({
                isRoot: true, canHandle: handleIds('a', 'b', 'c'), getChildren: (r?: TestResource) => {
                    if (!r) {
                        return rootList.map(x => ({ ...x }));
                    }
                    switch (r.id) {
                        case 'a': return aChildren();
                        case 'b': return bChildren();
                        case 'c': return cChildren();
                        default: return [];
                    }
                }
            });

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

// -- cross-store consistency harness -----------------------------------------
//
// DataItemTree keeps three separate stores in sync by hand (the query cache, the
// TreeIndex, and the per-node side tables for pagers/enrichment). These fixtures
// and the assertConsistent() harness are the safety net that catches a teardown
// path forgetting one of them. The randomized fuzzing cases are gated behind
// describeLongRunning (they run thousands of ops); the targeted scenarios below
// them are fast and always run.

/**
 * Fixture hierarchy:
 *
 * ```
 * a          b        c (leaf)
 * |- a1      `- b1
 * |   |- a1x     `- b1x
 * |   `- a1y
 * `- a2
 *     `- a2x
 * ```
 */
const CHILD_MAP = new Map<string, TestResource[]>([
    ['a', [{ id: 'a1' }, { id: 'a2' }]],
    ['a1', [{ id: 'a1x' }, { id: 'a1y' }]],
    ['a2', [{ id: 'a2x' }]],
    ['b', [{ id: 'b1' }]],
    ['b1', [{ id: 'b1x' }]],
]);

const ROOTS: TestResource[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

function buildTree(options?: { enrich?: boolean }): DataItemTree<TestResource> {
    const { executor } = createTestActionExecutor();
    const { vscode } = createMockVsCode();
    const tree = new DataItemTree<TestResource>(vscode, 'consistency', executor, r => r.id, 60_000);

    tree.registerProvider({
        isRoot: true,
        canHandle: canHandleNone,
        getChildren: () => ROOTS.map(r => ({ ...r })),
    });

    const branch: DataProvider<TestResource> = {
        isRoot: false,
        canHandle: (r: unknown): r is TestResource => CHILD_MAP.has((r as TestResource).id),
        getChildren: (r?: TestResource) => (r ? (CHILD_MAP.get(r.id) ?? []).map(c => ({ ...c })) : []),
        enrich: options?.enrich
            ? async (r: TestResource) => { await delay(1); r.enriched = true; return false; }
            : undefined,
    };
    tree.registerProvider(branch);
    return tree;
}

/**
 * Build a two-level tree with a single paged branch (`root` -> `p1`, `p2` across
 * two pages), so tests can install a live pager and then exercise a teardown
 * path. Each call re-creates the page iterator so the tree can be re-listed.
 */
function buildPagedTree(): DataItemTree<TestResource> {
    const { executor } = createTestActionExecutor();
    const { vscode } = createMockVsCode();
    const tree = new DataItemTree<TestResource>(vscode, 'consistency-paged', executor, r => r.id, 60_000);
    tree.registerProvider({
        isRoot: true,
        canHandle: canHandleNone,
        getChildren: () => [{ id: 'root' }],
    });
    tree.registerProvider({
        isRoot: false,
        canHandle: (r: unknown): r is TestResource => (r as TestResource).id === 'root',
        getChildren: () => {
            const iter = [
                { items: [{ id: 'p1' }], hasMore: true },
                { items: [{ id: 'p2' }], hasMore: false },
            ][Symbol.iterator]();
            return { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve(iter.next()) }) };
        },
    });
    return tree;
}

/** Join a path into a comparable scalar (keys never contain NUL). */
function pathKey(path: readonly string[]): string {
    return path.join('\u0000');
}

/** The query-key namespace {@linkcode DataItemTree} caches children under. */
const CHILDREN = 'children';

/**
 * The shape of {@linkcode DataItemTree}'s internal stores, reached by an
 * unchecked cast below. These fields are `private` (not `#private`), so a cast
 * is enough to inspect them -- this keeps the cross-store consistency invariants
 * entirely in the test without widening the class's public API with a
 * test-only method.
 */
interface DataItemTreeInternals<T> {
    readonly tree: TreeIndex<T>;
    readonly client: QueryClient;
    readonly pagers: ReadonlyMap<string, unknown>;
    readonly enrichmentPromises: ReadonlyMap<string, unknown>;
}

/**
 * Snapshot the internal stores of a {@linkcode DataItemTree} by reaching past
 * `private` with a cast: the indexed nodes (key -> path), every cached children
 * path (the `['children', ...path]` query keys with the prefix stripped), and
 * the live pager / enrichment side-table keys.
 */
function snapshotState(tree: DataItemTree<TestResource>): {
    indexed: Map<string, readonly string[]>;
    cachedPaths: string[][];
    pagerKeys: string[];
    enrichmentKeys: string[];
} {
    const internals = tree as unknown as DataItemTreeInternals<TestResource>;
    const indexed = new Map<string, readonly string[]>();
    for (const [key] of internals.tree.entries()) {
        indexed.set(key, internals.tree.pathOf(key)!);
    }
    const cachedPaths = internals.client.getQueryCache().getAll()
        .map(query => query.queryKey)
        .filter((key): key is readonly unknown[] => Array.isArray(key) && key[0] === CHILDREN)
        .map(key => key.slice(1) as string[]);
    return {
        indexed,
        cachedPaths,
        pagerKeys: [...internals.pagers.keys()],
        enrichmentKeys: [...internals.enrichmentPromises.keys()],
    };
}

/**
 * Assert the three cross-store invariants that {@linkcode DataItemTree} must
 * uphold at all times. These are properties the class enforces by hand (the
 * query cache, the index, and the per-node side tables are separate stores), so
 * this harness is the safety net that would catch a teardown path forgetting a
 * store.
 */
function assertConsistent(tree: DataItemTree<TestResource>, label: string): void {
    const { indexed, cachedPaths, pagerKeys, enrichmentKeys } = snapshotState(tree);

    // (1) No orphan cached children: every cached non-root children list belongs
    // to a currently-indexed node whose path is exactly that path.
    for (const path of cachedPaths) {
        if (path.length === 0) {
            continue; // the root listing has no owning node
        }
        const leafKey = path[path.length - 1];
        const indexedPath = indexed.get(leafKey);
        expect(indexedPath, `${label}: cached children for un-indexed node [${path.join('/')}]`).to.not.be.undefined;
        expect(pathKey(indexedPath!), `${label}: cache/index path mismatch for ${leafKey}`).to.equal(pathKey(path));
    }

    // (2) Ancestry closure: every indexed node's path ends at its own key and
    // every ancestor along it is indexed with the matching prefix -- no floating
    // descendant left behind by a partial eviction.
    for (const [key, path] of indexed) {
        expect(path[path.length - 1], `${label}: index path for ${key} must end at its own key`).to.equal(key);
        for (let i = 1; i < path.length; i++) {
            const ancestorKey = path[i - 1];
            const ancestorPath = indexed.get(ancestorKey);
            expect(ancestorPath, `${label}: ancestor ${ancestorKey} of ${key} not indexed`).to.not.be.undefined;
            expect(pathKey(ancestorPath!), `${label}: ancestor ${ancestorKey} path mismatch`).to.equal(pathKey(path.slice(0, i)));
        }
    }

    // (3) Side tables never outlive their node: every live pager / enrichment
    // key still corresponds to an indexed node.
    for (const key of pagerKeys) {
        expect(indexed.has(key), `${label}: pager for un-indexed node ${key}`).to.be.true;
    }
    for (const key of enrichmentKeys) {
        expect(indexed.has(key), `${label}: enrichment promise for un-indexed node ${key}`).to.be.true;
    }
}

/** Deterministic PRNG so a failing seed reproduces exactly. */
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

// The seeded randomized op-sequence cases run thousands of tree operations and
// comfortably exceed Mocha's 2s default, so they are gated as long-running and
// given headroom. The targeted scenarios in the (unit) block below are fast.
describeLongRunning('DataItemTree consistency randomized (unit)', function () {
    for (const enrich of [false, true]) {
        it(`should hold cross-store invariants across a randomized op sequence (enrich=${enrich})`, async () => {
            for (const seed of [1, 2, 7, 42, 1337, 99999]) {
                const tree = buildTree({ enrich });
                const rng = mulberry32(seed);
                const pick = <U>(arr: readonly U[]): U | undefined =>
                    arr.length > 0 ? arr[Math.floor(rng() * arr.length)] : undefined;

                await tree.getChildren(); // prime the roots
                assertConsistent(tree, `enrich=${enrich} seed=${seed} init`);

                for (let step = 0; step < 80; step++) {
                    const known = [...snapshotState(tree).indexed.keys()];
                    const node = pick(known);
                    const nodeRes = node !== undefined ? tree.get(node) : undefined;

                    switch (Math.floor(rng() * 9)) {
                        case 0: await tree.getChildren(); break;
                        case 1: if (nodeRes) { await tree.getChildren(nodeRes); } break;
                        case 2: if (nodeRes) { tree.invalidate(nodeRes); } break;
                        case 3: if (nodeRes) { tree.invalidate(selfOnly(nodeRes)); } break;
                        case 4: if (nodeRes) { tree.invalidate(subtreeOf(nodeRes)); } break;
                        case 5: if (nodeRes) { tree.remove(nodeRes); } break;
                        case 6: tree.invalidate(Roots); break;
                        case 7: {
                            const selector: Selector<TestResource> = r => (r.id.includes('a') ? 'subtree' : undefined);
                            if (rng() < 0.5) { tree.invalidate(selector); } else { tree.remove(selector); }
                            break;
                        }
                        default: tree.invalidate(Everything); break;
                    }

                    await delay(0); // let any background enrichment settle
                    assertConsistent(tree, `enrich=${enrich} seed=${seed} step=${step}`);
                }

                tree.dispose();
            }
        });
    }
}, { timeoutMs: 20_000 });

describe('DataItemTree consistency (unit)', () => {
    it('should leave every store empty after invalidate(Everything)', async () => {
        const tree = buildTree();
        await tree.getChildren();
        await tree.getChildren({ id: 'a' });
        await tree.getChildren({ id: 'a1' });

        tree.invalidate(Everything);

        const state = snapshotState(tree);
        expect(state.indexed.size, 'indexed').to.equal(0);
        expect(state.cachedPaths, 'cachedPaths').to.deep.equal([]);
        expect(state.pagerKeys, 'pagerKeys').to.deep.equal([]);
        expect(state.enrichmentKeys, 'enrichmentKeys').to.deep.equal([]);
    });

    it('should drop a removed subtree from every store', async () => {
        const tree = buildTree();
        await tree.getChildren();
        await tree.getChildren({ id: 'a' });
        await tree.getChildren({ id: 'a1' });
        await tree.getChildren({ id: 'a2' });

        // Sanity: the 'a' subtree is present before removal.
        expect(tree.get('a1x')).to.not.be.undefined;

        tree.remove({ id: 'a' });

        const state = snapshotState(tree);
        for (const key of ['a', 'a1', 'a2', 'a1x', 'a1y', 'a2x']) {
            expect(state.indexed.has(key), `indexed still has ${key}`).to.be.false;
        }
        // No cached children path may reference any node in the removed subtree.
        for (const path of state.cachedPaths) {
            expect(path.includes('a'), `cache still references 'a' subtree: ${path.join('/')}`).to.be.false;
        }
        assertConsistent(tree, 'after remove(a)');
    });

    it('should tear down every departed subtree in one batched reconcile', async () => {
        // Exercises the batched mass-departure path (reconcileChildren ->
        // evictSubtrees): a large root set collapses to a single survivor on
        // re-list, so many apexes -- each with its own descendants -- depart at
        // once. This is the 20k-subscription sign-out shape in miniature.
        const { executor } = createTestActionExecutor();
        const { vscode } = createMockVsCode();
        const tree = new DataItemTree<TestResource>(vscode, 'mass-departure', executor, r => r.id, 60_000);

        const rootCount = 12;
        let roots: TestResource[] = Array.from({ length: rootCount }, (_v, i) => ({ id: `r${i}` }));
        tree.registerProvider({
            isRoot: true,
            canHandle: canHandleNone,
            getChildren: () => roots.map(r => ({ ...r })),
        });
        // Every root gets two children and each child a grandchild, so a departing
        // root drops a three-node subtree from every store.
        tree.registerProvider({
            isRoot: false,
            canHandle: (r: unknown): r is TestResource => /^r\d+$/.test((r as TestResource).id) || /^r\d+c\d$/.test((r as TestResource).id),
            getChildren: (r?: TestResource) => {
                if (r === undefined) { return []; }
                if (/^r\d+$/.test(r.id)) { return [{ id: `${r.id}c0` }, { id: `${r.id}c1` }]; }
                if (/^r\d+c\d$/.test(r.id)) { return [{ id: `${r.id}g` }]; }
                return [];
            },
        });

        // Fully materialize every root's subtree.
        for (const root of await tree.getChildren()) {
            for (const child of await tree.getChildren(root)) {
                await tree.getChildren(child);
            }
        }

        // Sanity: a representative deep node is present before the collapse.
        expect(tree.get('r7c1g'), 'deep node present before departure').to.not.be.undefined;

        // Collapse to a single survivor and re-list the roots.
        roots = [{ id: 'r0' }];
        tree.invalidate(Roots);
        await tree.getChildren();

        const state = snapshotState(tree);
        // The survivor's own subtree is untouched.
        expect(state.indexed.has('r0'), 'survivor root evicted').to.be.true;
        // Every departed root and its descendants are gone from all stores.
        for (let i = 1; i < rootCount; i++) {
            for (const key of [`r${i}`, `r${i}c0`, `r${i}c1`, `r${i}c0g`, `r${i}c1g`]) {
                expect(state.indexed.has(key), `indexed still has ${key}`).to.be.false;
            }
        }
        for (const path of state.cachedPaths) {
            for (const seg of path) {
                const rootId = /^r\d+/.exec(seg)?.[0];
                expect(rootId === undefined || rootId === 'r0', `cache still references departed root via ${seg}: ${path.join('/')}`).to.be.true;
            }
        }
        assertConsistent(tree, 'after mass root departure');
    });

    it('should drop a paginated node pager on removal', async () => {
        const tree = buildPagedTree();

        await tree.getChildren();
        await tree.getChildren({ id: 'root' }); // installs a pager
        expect(snapshotState(tree).pagerKeys).to.deep.equal(['root']);

        tree.remove({ id: 'root' });
        expect(snapshotState(tree).pagerKeys, 'pager survived removal').to.deep.equal([]);
        assertConsistent(tree, 'after remove(paged root)');
    });

    it('should clear a live pager on invalidate(Everything)', async () => {
        // The full-teardown choke point (clearNodeState) clears the pager map,
        // a distinct path from the per-key eviction that remove() drives. Without
        // a live pager here it would go unexercised.
        const tree = buildPagedTree();

        await tree.getChildren();
        await tree.getChildren({ id: 'root' }); // installs a pager
        expect(snapshotState(tree).pagerKeys).to.deep.equal(['root']);

        tree.invalidate(Everything);

        const state = snapshotState(tree);
        expect(state.pagerKeys, 'pager survived invalidate(Everything)').to.deep.equal([]);
        expect(state.indexed.size, 'indexed').to.equal(0);
        expect(state.cachedPaths, 'cachedPaths').to.deep.equal([]);
        assertConsistent(tree, 'after invalidate(Everything) with live pager');
    });

    it('should clear a live pager on dispose', async () => {
        // dispose() shares the same clearAllState choke point as
        // invalidate(Everything); a live pager must not survive it.
        const tree = buildPagedTree();

        await tree.getChildren();
        await tree.getChildren({ id: 'root' }); // installs a pager
        expect(snapshotState(tree).pagerKeys).to.deep.equal(['root']);

        tree.dispose();

        const state = snapshotState(tree);
        expect(state.pagerKeys, 'pager survived dispose').to.deep.equal([]);
        expect(state.indexed.size, 'indexed').to.equal(0);
    });
});
