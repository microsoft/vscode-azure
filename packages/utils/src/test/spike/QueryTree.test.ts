/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { mock } from 'node:test';
import { delay } from '../../base/delay';
import { QueryTree, type QueryTreeOptions } from '../../spike/QueryTree';
import type { PageResult, QueryTreeProvider } from '../../spike/QueryTreeProvider';

// ---------------------------------------------------------------------------
// Test model
//
// Node ids encode their own path with '/' separators (mirroring hierarchical
// Azure resource URIs), so getPath is a pure split -- this is what turns
// subtree invalidation into a query-key prefix match.
// ---------------------------------------------------------------------------

interface Node {
    readonly id: string;
}

const n = (id: string): Node => ({ id });

const isNode = (node: unknown): node is Node =>
    typeof node === 'object' && node !== null && typeof (node as Node).id === 'string';

function options(overrides?: Partial<QueryTreeOptions<Node>>): QueryTreeOptions<Node> {
    return {
        getKey: node => node.id,
        getPath: node => node.id.split('/'),
        staleTime: 60_000,
        ...overrides,
    };
}

/**
 * Build a provider over a static child map (parentId -> children). `roots` are
 * returned for the root-level (`undefined`) fetch. The `listChildren` mock is
 * returned so tests can assert fetch/dedup counts.
 */
function mapProvider(roots: Node[], childMap: Record<string, Node[]>) {
    const listChildren = mock.fn(async (node: Node | undefined, _signal: AbortSignal): Promise<readonly Node[]> => {
        await delay(0);
        return node === undefined ? roots : (childMap[node.id] ?? []);
    });
    const provider: QueryTreeProvider<Node> = {
        isRoot: true,
        canHandle: isNode,
        listChildren,
    };
    return { provider, listChildren };
}

describe('QueryTree spike (unit)', () => {
    describe('provider dispatch, caching, dedup', () => {
        it('dispatches root and branch fetches through canHandle providers', async () => {
            const tree = new QueryTree<Node>(options());
            const { provider } = mapProvider([n('a'), n('b')], { a: [n('a/x'), n('a/y')] });
            tree.registerProvider(provider);

            const roots = await tree.getChildren();
            expect(roots.map(r => r.id)).to.deep.equal(['a', 'b']);

            const children = await tree.getChildren(n('a'));
            expect(children.map(c => c.id)).to.deep.equal(['a/x', 'a/y']);

            tree.dispose();
        });

        it('dedupes concurrent fetches for the same node into one call', async () => {
            const tree = new QueryTree<Node>(options());
            const { provider, listChildren } = mapProvider([n('a')], { a: [n('a/x')] });
            tree.registerProvider(provider);

            const [first, second] = await Promise.all([tree.getChildren(n('a')), tree.getChildren(n('a'))]);
            expect(first).to.deep.equal(second);
            // One call for node 'a' (the concurrent pair was deduped).
            const aCalls = listChildren.mock.calls.filter(c => c.arguments[0]?.id === 'a');
            expect(aCalls.length).to.equal(1);

            tree.dispose();
        });

        it('serves repeat reads from cache within staleTime', async () => {
            const tree = new QueryTree<Node>(options());
            const { provider, listChildren } = mapProvider([n('a')], { a: [n('a/x')] });
            tree.registerProvider(provider);

            await tree.getChildren(n('a'));
            await tree.getChildren(n('a'));
            const aCalls = listChildren.mock.calls.filter(c => c.arguments[0]?.id === 'a');
            expect(aCalls.length).to.equal(1);

            tree.dispose();
        });

        it('re-fetches once stale (staleTime = 0)', async () => {
            const tree = new QueryTree<Node>(options({ staleTime: 0 }));
            const { provider, listChildren } = mapProvider([n('a')], { a: [n('a/x')] });
            tree.registerProvider(provider);

            await tree.getChildren(n('a'));
            await tree.getChildren(n('a'));
            const aCalls = listChildren.mock.calls.filter(c => c.arguments[0]?.id === 'a');
            expect(aCalls.length).to.equal(2);

            tree.dispose();
        });
    });

    describe('subtree invalidation via query-key prefix', () => {
        it('invalidates a node AND its descendants, but not siblings', async () => {
            const tree = new QueryTree<Node>(options());
            const { provider, listChildren } = mapProvider(
                [n('a'), n('x')],
                { a: [n('a/b')], 'a/b': [n('a/b/c')], x: [n('x/y')] },
            );
            tree.registerProvider(provider);

            // Prime a subtree under 'a' (a -> a/b -> a/b/c) and a sibling 'x'.
            await tree.getChildren(n('a'));
            await tree.getChildren(n('a/b'));
            await tree.getChildren(n('x'));

            const callsFor = (id: string) => listChildren.mock.calls.filter(c => c.arguments[0]?.id === id).length;
            expect(callsFor('a')).to.equal(1);
            expect(callsFor('a/b')).to.equal(1);
            expect(callsFor('x')).to.equal(1);

            // One prefix invalidation of ['children','a'] marks the whole subtree stale.
            await tree.invalidateSubtree(n('a'));

            await tree.getChildren(n('a'));
            await tree.getChildren(n('a/b'));
            await tree.getChildren(n('x'));

            expect(callsFor('a')).to.equal(2);   // re-fetched
            expect(callsFor('a/b')).to.equal(2);  // descendant re-fetched
            expect(callsFor('x')).to.equal(1);    // sibling untouched

            tree.dispose();
        });

        it('invalidates the whole tree when passed undefined', async () => {
            const tree = new QueryTree<Node>(options());
            const { provider, listChildren } = mapProvider([n('a'), n('x')], { a: [n('a/b')], x: [n('x/y')] });
            tree.registerProvider(provider);

            await tree.getChildren(n('a'));
            await tree.getChildren(n('x'));
            await tree.invalidateSubtree();
            await tree.getChildren(n('a'));
            await tree.getChildren(n('x'));

            const callsFor = (id: string) => listChildren.mock.calls.filter(c => c.arguments[0]?.id === id).length;
            expect(callsFor('a')).to.equal(2);
            expect(callsFor('x')).to.equal(2);

            tree.dispose();
        });
    });

    describe('enrichment as a dependent query', () => {
        it('computes derived data via its own cached/deduped query without mutating the node', async () => {
            const tree = new QueryTree<Node>(options());
            const enrich = mock.fn(async (node: Node, _signal: AbortSignal) => {
                await delay(0);
                return { label: node.id.toUpperCase() };
            });
            const { provider } = mapProvider([n('a')], {});
            tree.registerProvider({ ...provider, enrich });

            const node = n('a');
            const [e1, e2] = await Promise.all([
                tree.getEnrichment<{ label: string }>(node),
                tree.getEnrichment<{ label: string }>(node),
            ]);
            expect(e1?.label).to.equal('A');
            expect(e2?.label).to.equal('A');
            expect(enrich.mock.callCount()).to.equal(1); // deduped + cached
            expect(node).to.deep.equal({ id: 'a' }); // node not mutated

            tree.dispose();
        });

        it('self-invalidation refreshes enrichment but leaves children cached', async () => {
            const tree = new QueryTree<Node>(options());
            const enrich = mock.fn((node: Node) => Promise.resolve({ label: node.id }));
            const { provider, listChildren } = mapProvider([n('a')], { a: [n('a/x')] });
            tree.registerProvider({ ...provider, enrich });

            await tree.getChildren(n('a'));
            await tree.getEnrichment(n('a'));
            await tree.invalidateSelf(n('a'));
            await tree.getEnrichment(n('a'));
            await tree.getChildren(n('a'));

            expect(enrich.mock.callCount()).to.equal(2); // enrichment refreshed
            const aCalls = listChildren.mock.calls.filter(c => c.arguments[0]?.id === 'a').length;
            expect(aCalls).to.equal(1); // children NOT re-fetched

            tree.dispose();
        });
    });

    describe('true cancellation via AbortSignal', () => {
        it('aborts an in-flight fetch when the node is cancelled', async () => {
            const tree = new QueryTree<Node>(options());
            let aborted = false;
            const provider: QueryTreeProvider<Node> = {
                isRoot: false,
                canHandle: isNode,
                listChildren: (_node, signal) => new Promise<readonly Node[]>((_resolve, reject) => {
                    signal.addEventListener('abort', () => {
                        aborted = true;
                        reject(new Error('aborted'));
                    });
                }),
            };
            tree.registerProvider(provider);

            const pending = tree.getChildren(n('slow')).catch(() => 'rejected');
            await delay(5); // let the fetch start
            await tree.cancel(n('slow'));

            expect(aborted).to.equal(true);
            expect(await pending).to.equal('rejected');

            tree.dispose();
        });
    });

    describe('pagination via InfiniteQueryObserver', () => {
        it('loads pages incrementally and reports hasMore', async () => {
            const tree = new QueryTree<Node>(options());
            const pages: Record<number, PageResult<Node>> = {
                0: { items: [n('p/0a'), n('p/0b')], nextPageParam: 1 },
                1: { items: [n('p/1a')], nextPageParam: undefined },
            };
            const provider: QueryTreeProvider<Node> = {
                canHandle: isNode,
                listChildren: () => Promise.resolve([]),
                listPage: async (_node, pageParam) => {
                    await delay(0);
                    return pages[pageParam];
                },
            };
            tree.registerProvider(provider);

            const pager = tree.paginate(n('p'));

            await pager.loadMore(); // page 0
            expect(pager.items.map(i => i.id)).to.deep.equal(['p/0a', 'p/0b']);
            expect(pager.hasMore).to.equal(true);

            await pager.loadMore(); // page 1
            expect(pager.items.map(i => i.id)).to.deep.equal(['p/0a', 'p/0b', 'p/1a']);
            expect(pager.hasMore).to.equal(false);

            pager.dispose();
            tree.dispose();
        });
    });

    describe('change subscription (TreeDataProvider adapter hook)', () => {
        it('notifies subscribers when the cache updates', async () => {
            const tree = new QueryTree<Node>(options());
            const { provider } = mapProvider([n('a')], { a: [n('a/x')] });
            tree.registerProvider(provider);

            const listener = mock.fn();
            const sub = tree.onDidChange(listener);

            await tree.getChildren(n('a'));

            expect(listener.mock.callCount()).to.be.greaterThan(0);

            sub.dispose();
            tree.dispose();
        });
    });
});
