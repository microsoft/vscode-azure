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

interface TestResource {
    id: string;
    enriched?: boolean;
}

const canHandleAll = (_r: unknown): _r is TestResource => true;
const canHandleNone = (_r: unknown): _r is TestResource => false;

function createTree(ttl = 60_000) {
    const executor = new ActionExecutor(new NullTelemetryReporter());
    return new DataItemTree<TestResource>('test', executor, r => r.id, ttl);
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

            let resolveEnrich!: () => void;
            tree.registerProvider({
                isRoot: true,
                canHandle: canHandleAll,
                getChildren: () => [{ id: 'item' }],
                enrich: () => new Promise<boolean>(resolve => {
                    resolveEnrich = () => { resolve(false); };
                }),
            });

            await tree.getChildren();

            // Remove the item while enrichment is still in flight
            tree.removeItem({ id: 'item' });

            const onChange = mock.fn();
            tree.onDidChange(onChange);

            // Now let enrichment resolve -- should be a no-op
            resolveEnrich();
            await new Promise(r => { setTimeout(r, 10); });

            expect(onChange.mock.callCount()).to.equal(0);
        });

        it('should not re-insert children when loadMore resolves after removal', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'parent' }]));

            let resolveNextPage!: () => void;
            const pagePromise = new Promise<IteratorResult<Page<TestResource>>>(resolve => {
                resolveNextPage = () => {
                    resolve({
                        done: false,
                        value: { items: [{ id: 'orphan' }], hasMore: false },
                    });
                };
            });

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

    describe('node state tracking', () => {
        it('should mark and check transient state', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'a' }]));
            await tree.getChildren();

            const resource = { id: 'a' };
            expect(tree.hasState(resource, 'deleting')).to.be.false;

            tree.markState(resource, 'deleting');
            expect(tree.hasState(resource, 'deleting')).to.be.true;
        });

        it('should clear transient state', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'a' }]));
            await tree.getChildren();

            const resource = { id: 'a' };
            tree.markState(resource, 'deleting');
            tree.clearState(resource, 'deleting');
            expect(tree.hasState(resource, 'deleting')).to.be.false;
        });

        it('should support multiple states on the same resource', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'a' }]));
            await tree.getChildren();

            const resource = { id: 'a' };
            tree.markState(resource, 'deleting');
            tree.markState(resource, 'updating');
            expect(tree.hasState(resource, 'deleting')).to.be.true;
            expect(tree.hasState(resource, 'updating')).to.be.true;

            tree.clearState(resource, 'deleting');
            expect(tree.hasState(resource, 'deleting')).to.be.false;
            expect(tree.hasState(resource, 'updating')).to.be.true;
        });

        it('should fire onDidChange only on state transition', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'a' }]));
            await tree.getChildren();

            const resource = { id: 'a' };
            const events: unknown[] = [];
            tree.onDidChange(e => events.push(e));

            tree.markState(resource, 'deleting');
            expect(events).to.have.length(1);

            // Marking the same state again should not fire
            tree.markState(resource, 'deleting');
            expect(events).to.have.length(1);

            // Marking a different state should fire
            tree.markState(resource, 'updating');
            expect(events).to.have.length(2);
        });

        it('should clear states when removeItem is called', async () => {
            const tree = createTree();
            const childMap = new Map([['parent', [{ id: 'child' }]]]);
            tree.registerProvider(createRootProvider([{ id: 'parent' }]));
            tree.registerProvider(createBranchProvider(childMap));
            await tree.getChildren();
            await tree.getChildren({ id: 'parent' });

            tree.markState({ id: 'parent' }, 'deleting');
            tree.markState({ id: 'child' }, 'updating');

            tree.removeItem({ id: 'parent' });

            expect(tree.hasState({ id: 'parent' }, 'deleting')).to.be.false;
            expect(tree.hasState({ id: 'child' }, 'updating')).to.be.false;
        });

        it('should clear descendant states on invalidate with includeChildren', async () => {
            const tree = createTree();
            const childMap = new Map([['parent', [{ id: 'child' }]]]);
            tree.registerProvider(createRootProvider([{ id: 'parent' }]));
            tree.registerProvider(createBranchProvider(childMap));
            await tree.getChildren();
            await tree.getChildren({ id: 'parent' });

            tree.markState({ id: 'parent' }, 'updating');
            tree.markState({ id: 'child' }, 'deleting');

            tree.invalidate({ id: 'parent' }, true);

            // Parent state should remain (invalidate only clears children)
            expect(tree.hasState({ id: 'parent' }, 'updating')).to.be.true;
            // Child state should be cleared
            expect(tree.hasState({ id: 'child' }, 'deleting')).to.be.false;
        });

        it('should clear all states on invalidateAll', async () => {
            const tree = createTree();
            tree.registerProvider(createRootProvider([{ id: 'a' }, { id: 'b' }]));
            await tree.getChildren();

            tree.markState({ id: 'a' }, 'deleting');
            tree.markState({ id: 'b' }, 'updating');

            tree.invalidateAll();

            expect(tree.hasState({ id: 'a' }, 'deleting')).to.be.false;
            expect(tree.hasState({ id: 'b' }, 'updating')).to.be.false;
        });
    });
});
