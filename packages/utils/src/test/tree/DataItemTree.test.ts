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
            tree.invalidateAll();
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

        it('should not re-fetch when includeChildren is false', async () => {
            const tree = createTree();
            const fn = mock.fn(() => [{ id: 'child' }]);
            tree.registerProvider(createRootProvider([{ id: 'root' }]));
            tree.registerProvider({ isRoot: false, canHandle: canHandleAll, getChildren: fn });

            await tree.getChildren();
            await tree.getChildren({ id: 'root' });

            tree.invalidate({ id: 'root' }, false);
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

        it('should clear all caches on invalidateAll', async () => {
            const tree = createTree();
            const fn = mock.fn(() => [{ id: 'root' }]);
            tree.registerProvider({ isRoot: true, canHandle: canHandleNone, getChildren: fn });

            await tree.getChildren();
            tree.invalidateAll();
            await tree.getChildren();

            expect(fn.mock.callCount()).to.equal(2);
        });

        it('should fire onDidChange with undefined on invalidateAll', () => {
            const tree = createTree();
            const onChange = mock.fn();
            tree.onDidChange(onChange);

            tree.invalidateAll();
            expect(onChange.mock.callCount()).to.equal(1);
            expect(onChange.mock.calls[0].arguments[0]).to.be.undefined;
        });
    });

    describe('provider change events', () => {
        it('should invalidate when provider fires onDidChange for a resource', async () => {
            const tree = createTree();
            let fireChange!: (event: { resource: TestResource; includeChildren: boolean }) => void;
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
            fireChange({ resource: { id: 'a' }, includeChildren: true });

            expect(onChange.mock.callCount()).to.be.greaterThan(0);
        });

        it('should invalidateAll when provider fires onDidChange with undefined resource', async () => {
            const tree = createTree();
            let fireChange!: (event: { resource: undefined; includeChildren: boolean }) => void;
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

            fireChange({ resource: undefined, includeChildren: true });

            // After invalidateAll, get('a') should be undefined
            expect(tree.get('a')).to.be.undefined;
        });
    });

    describe('removeItem', () => {
        it('should remove a branch child without evicting siblings', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'parent' }]));
            tree.registerProvider(createBranchProvider(
                new Map([['parent', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]]]),
            ));

            await tree.getChildren();
            await tree.getChildren({ id: 'parent' });

            tree.removeItem({ id: 'b' });

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

            tree.removeItem({ id: 'child' });

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

            tree.removeItem({ id: 'child' });

            expect(tree.get('child')).to.be.undefined;
            expect(tree.get('grandchild')).to.be.undefined;
        });

        it('should remove a root item and fire undefined (full refresh)', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'r1' }, { id: 'r2' }]));
            await tree.getChildren();

            const onChange = mock.fn();
            tree.onDidChange(onChange);

            tree.removeItem({ id: 'r1' });

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

            tree.removeItem({ id: 'remove' });

            await tree.getChildren({ id: 'keep' });
            expect(siblingFetch.mock.callCount()).to.equal(1);
        });

        it('should be a no-op when the item is not in the cache', () => {
            const tree = createTree();

            const onChange = mock.fn();
            tree.onDidChange(onChange);

            tree.removeItem({ id: 'nonexistent' });

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

            tree.removeItem({ id: 'b' });

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
            tree.removeItem({ id: 'item' });

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
            tree.removeItem({ id: 'parent' });

            // Resolve the page -- should be discarded
            resolveNextPage();
            await loadPromise;

            expect(tree.get('orphan')).to.be.undefined;
        });
    });

    describe('tag-based invalidation', () => {
        const handleIds = (...ids: string[]) =>
            (r: unknown): r is TestResource => ids.includes((r as TestResource).id);

        /**
         * Build a tree shaped like the real account / tenant / subscription /
         * resource hierarchy:
         *
         * - `acct` (root) -> `tenN` (tenant) -> `subN` (subscription) -> `resN` (resource)
         *
         * A single "account" provider (canHandle account + tenant, like the
         * production {@linkcode AzureAccountDataProvider}) produces and tags the
         * account / tenant / subscription levels with semantic identity tags. A
         * separate "resource" provider produces leaf resources under each
         * subscription. The tree records only these semantic tags -- there are
         * no auto-derived structural tags; subtree membership is found by
         * walking child pointers.
         *
         * @param tenants - per-account tenant ids
         * @param subsByTenant - tenant id -> subscription ids
         */
        function buildHierarchy(tenants: string[], subsByTenant: Record<string, string[]>) {
            const tree = createTree();
            const subIds = Object.values(subsByTenant).flat();

            tree.registerProvider({
                isRoot: true,
                // Mirrors AzureAccountDataProvider: handles account + tenant.
                canHandle: handleIds('acct', ...tenants),
                getChildren: (r?: TestResource) => {
                    if (!r) {
                        return [{ id: 'acct' }];
                    }
                    if (r.id === 'acct') {
                        return tenants.map(id => ({ id }));
                    }
                    return (subsByTenant[r.id] ?? []).map(id => ({ id }));
                },
                getTags: (r?: TestResource) => {
                    if (!r) {
                        return [];
                    }
                    if (r.id === 'acct') {
                        return ['account:acct'];
                    }
                    if (tenants.includes(r.id)) {
                        return [`tenant:${r.id}`];
                    }
                    if (subIds.includes(r.id)) {
                        // A shared `kind:sub` tag lets one call sweep every
                        // subscription regardless of which tenant it lives under.
                        return [`subscription:${r.id}`, 'kind:sub'];
                    }
                    return [];
                },
            });

            tree.registerProvider({
                isRoot: false,
                canHandle: handleIds(...subIds),
                getChildren: (r?: TestResource) => [{ id: `${r?.id ?? 'sub'}-res` }],
            });

            return { tree };
        }

        it('should evict a node and its subtree by semantic tag, firing for the surviving parent', async () => {
            const { tree } = buildHierarchy(['ten'], { ten: ['sub'] });

            await tree.getChildren();
            await tree.getChildren({ id: 'acct' });
            await tree.getChildren({ id: 'ten' });
            await tree.getChildren({ id: 'sub' });
            expect(tree.get('sub')).to.not.be.undefined;
            expect(tree.get('sub-res')).to.not.be.undefined;

            const onChange = mock.fn();
            tree.onDidChange(onChange);

            tree.invalidateByTag('subscription:sub');

            // Subtree gone, but the parent tenant survives and is the single
            // affected scope.
            expect(tree.get('sub')).to.be.undefined;
            expect(tree.get('sub-res')).to.be.undefined;
            expect(tree.get('ten')).to.not.be.undefined;
            expect(onChange.mock.callCount()).to.equal(1);
            expect((onChange.mock.calls[0].arguments[0] as TestResource).id).to.equal('ten');
        });

        it('should evict the matched node itself when it carries the tag', async () => {
            const { tree } = buildHierarchy(['ten'], { ten: ['sub'] });

            await tree.getChildren();
            await tree.getChildren({ id: 'acct' });
            await tree.getChildren({ id: 'ten' });
            await tree.getChildren({ id: 'sub' });

            const onChange = mock.fn();
            tree.onDidChange(onChange);

            // `account:acct` is carried by the account node itself, so the whole
            // subtree including the account is removed and the root listing changes.
            tree.invalidateByTag('account:acct');

            expect(tree.get('acct')).to.be.undefined;
            expect(tree.get('ten')).to.be.undefined;
            expect(tree.get('sub')).to.be.undefined;
            expect(tree.get('sub-res')).to.be.undefined;
            expect(onChange.mock.callCount()).to.equal(1);
            expect(onChange.mock.calls[0].arguments[0]).to.be.undefined;

            // Root listing no longer contains the evicted account.
            const roots = await tree.getChildren();
            expect(roots).to.deep.equal([]);
        });

        it('should invalidate a tag shared across multiple branches with one call', async () => {
            const { tree } = buildHierarchy(['ten1', 'ten2'], { ten1: ['sub1'], ten2: ['sub2'] });

            await tree.getChildren();
            await tree.getChildren({ id: 'acct' });
            await tree.getChildren({ id: 'ten1' });
            await tree.getChildren({ id: 'ten2' });
            await tree.getChildren({ id: 'sub1' });
            await tree.getChildren({ id: 'sub2' });

            const onChange = mock.fn();
            tree.onDidChange(onChange);

            // `kind:sub` is carried by every subscription across both tenants.
            tree.invalidateByTag('kind:sub');

            expect(tree.get('sub1')).to.be.undefined;
            expect(tree.get('sub2')).to.be.undefined;
            expect(tree.get('sub1-res')).to.be.undefined;
            expect(tree.get('sub2-res')).to.be.undefined;
            // Both tenants survive.
            expect(tree.get('ten1')).to.not.be.undefined;
            expect(tree.get('ten2')).to.not.be.undefined;
            // A cross-branch eviction coalesces to a single full refresh.
            expect(onChange.mock.callCount()).to.equal(1);
            expect(onChange.mock.calls[0].arguments[0]).to.be.undefined;
        });

        it('should reconcile roots on invalidateRoot: preserve survivors, evict removed, fetch new lazily', async () => {
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
            tree.invalidateRoot();
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

        it('should dispatch provider change events carrying tags to invalidateByTag', async () => {
            let fireChange!: (event: DataProviderChangeEvent<TestResource>) => void;
            const { tree } = buildHierarchy(['ten'], { ten: ['sub'] });
            tree.registerProvider({
                isRoot: false,
                canHandle: handleIds('never'),
                getChildren: () => [],
                onDidChange: (listener) => { fireChange = listener; return { dispose: () => { /* noop */ } }; },
            });

            await tree.getChildren();
            await tree.getChildren({ id: 'acct' });
            await tree.getChildren({ id: 'ten' });
            await tree.getChildren({ id: 'sub' });
            expect(tree.get('sub')).to.not.be.undefined;

            fireChange({ resource: undefined, includeChildren: true, tags: ['subscription:sub'] });

            expect(tree.get('sub')).to.be.undefined;
        });

        it('should reconcile (not wipe) on a root change event with includeChildren false', async () => {
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
            fireChange({ resource: undefined, includeChildren: false });

            const roots = await tree.getChildren();
            expect(roots.map(r => r.id)).to.deep.equal(['a']);
            // Survivor's subtree preserved (reconcile, not full wipe).
            await tree.getChildren({ id: 'a' });
            expect(aChildren.mock.callCount()).to.equal(1);
        });

        it('should be a no-op for unknown tags', () => {
            const tree = createTree();
            const onChange = mock.fn();
            tree.onDidChange(onChange);

            tree.invalidateByTag('does-not-exist');

            expect(onChange.mock.callCount()).to.equal(0);
        });

        it('should not register tags for untagged providers (back-compat)', async () => {
            const tree = createTree();
            const fetch = mock.fn(() => [{ id: 'child' }]);
            tree.registerProvider(createRootProvider([{ id: 'root' }]));
            tree.registerProvider({ isRoot: false, canHandle: canHandleAll, getChildren: fetch });

            await tree.getChildren();
            await tree.getChildren({ id: 'root' });

            tree.invalidateByTag('anything');
            await tree.getChildren({ id: 'root' });

            expect(fetch.mock.callCount()).to.equal(1);
        });

        it('should clear the tag index on invalidateAll', async () => {
            const { tree } = buildHierarchy(['ten'], { ten: ['sub'] });

            await tree.getChildren();
            await tree.getChildren({ id: 'acct' });
            await tree.getChildren({ id: 'ten' });
            await tree.getChildren({ id: 'sub' });

            tree.invalidateAll();

            const onChange = mock.fn();
            tree.onDidChange(onChange);
            tree.invalidateByTag('subscription:sub');

            expect(onChange.mock.callCount()).to.equal(0);
        });
    });
});
