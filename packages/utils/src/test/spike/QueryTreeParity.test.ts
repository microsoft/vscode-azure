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
// Parity tests: reproduce the *hardest* behaviors locked in by
// DataItemTree.test.ts on the query-core backing, to prove what query-core
// dissolves. Grouped by the three "tiers" of DataItemTree's trickiest code:
//   Tier 1 -- in-flight page concurrency guard (the `generation` counter).
//   Tier 2 -- selector invalidate/remove + root reconciliation.
//   Tier 3 -- background enrichment cancel-on-removal (no spurious fire).
// The scenarios mirror DataItemTree.test.ts; the assertions show the same
// observable outcome achieved with none of the bespoke bookkeeping.
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

/** A manually-settled promise, for driving in-flight fetches deterministically. */
function deferred<T>() {
    let resolve: (value: T) => void = () => { /* replaced below */ };
    let reject: (error: unknown) => void = () => { /* replaced below */ };
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/**
 * A hierarchical provider over a static child map with per-node call counting.
 * `roots` are returned for the root (`undefined`) fetch. The returned `calls`
 * map records how many times each node's children were fetched (`'<root>'` for
 * the root listing), so tests can assert survival / refetch precisely.
 */
function countingProvider(roots: Node[], childMap: Record<string, Node[]>) {
    const calls = new Map<string, number>();
    const bump = (key: string) => calls.set(key, (calls.get(key) ?? 0) + 1);
    const provider: QueryTreeProvider<Node> = {
        isRoot: true,
        canHandle: isNode,
        listChildren: async (node, _signal) => {
            await delay(0);
            bump(node?.id ?? '<root>');
            return node === undefined ? roots : (childMap[node.id] ?? []);
        },
    };
    return { provider, calls };
}

describe('QueryTree parity with DataItemTree (unit)', () => {
    // -----------------------------------------------------------------------
    // Tier 1: in-flight page discarded on subtree invalidation.
    // DataItemTree relies on a per-node `generation` counter bumped by
    // wipeSubtree so a page resolving after invalidation is dropped. Here the
    // page belongs to a keyed query; invalidation cancels the in-flight fetch,
    // so a late page cannot land -- no generation counter exists.
    // -----------------------------------------------------------------------
    describe('Tier 1: in-flight page concurrency (no generation counter)', () => {
        it('discards a page that resolves after its subtree was invalidated', async () => {
            const tree = new QueryTree<Node>(options());
            const page1 = deferred<PageResult<Node>>();
            const provider: QueryTreeProvider<Node> = {
                canHandle: isNode,
                listChildren: () => Promise.resolve([]),
                // Page 1 ignores the abort signal on purpose: even a page that
                // resolves anyway must not land once the query was cancelled.
                listPage: (_node, pageParam) => pageParam === 0
                    ? Promise.resolve<PageResult<Node>>({ items: [n('p/0a'), n('p/0b')], nextPageParam: 1 })
                    : page1.promise,
            };
            tree.registerProvider(provider);

            const pager = tree.paginate(n('p'));
            await pager.loadMore(); // page 0 lands
            expect(pager.items.map(i => i.id)).to.deep.equal(['p/0a', 'p/0b']);
            expect(pager.hasMore).to.equal(true);

            const inflight = pager.loadMore().catch(() => undefined); // page 1, deferred
            await delay(5); // let the fetch start
            await tree.invalidateSubtree(n('p')); // cancels the in-flight page
            page1.resolve({ items: [n('p/1a')], nextPageParam: undefined }); // late arrival
            await inflight;
            await delay(5);

            // The late page did NOT append: no orphan child, no generation guard.
            expect(pager.items.map(i => i.id)).to.deep.equal(['p/0a', 'p/0b']);

            pager.dispose();
            tree.dispose();
        });
    });

    // -----------------------------------------------------------------------
    // Tier 2: selector invalidate/remove + root reconciliation.
    // -----------------------------------------------------------------------
    describe('Tier 2: selector targeting and root reconciliation', () => {
        it('invalidateWhere collapses nested subtree matches to the apex and spares siblings', async () => {
            const tree = new QueryTree<Node>(options());
            const { provider, calls } = countingProvider(
                [n('a'), n('x')],
                { 'a': [n('a/b')], 'a/b': [n('a/b/c')], 'x': [n('x/y')] },
            );
            tree.registerProvider(provider);

            await tree.getChildren();
            await tree.getChildren(n('a'));
            await tree.getChildren(n('a/b'));
            await tree.getChildren(n('a/b/c'));
            await tree.getChildren(n('x'));

            // Both 'a' and 'a/b' say subtree; apex 'a' subsumes 'a/b'.
            await tree.invalidateWhere(node => (node.id === 'a' || node.id === 'a/b') ? 'subtree' : undefined);

            await tree.getChildren(n('a'));
            await tree.getChildren(n('a/b'));
            await tree.getChildren(n('a/b/c'));
            await tree.getChildren(n('x'));

            expect(calls.get('a')).to.equal(2);
            expect(calls.get('a/b')).to.equal(2);
            expect(calls.get('a/b/c')).to.equal(2);
            expect(calls.get('x')).to.equal(1); // untouched sibling subtree

            tree.dispose();
        });

        it('invalidateWhere with a self verdict refreshes enrichment only, leaving children cached', async () => {
            const tree = new QueryTree<Node>(options());
            const enrich = mock.fn((node: Node) => Promise.resolve({ label: node.id }));
            const { provider, calls } = countingProvider([n('a')], { 'a': [n('a/b')] });
            tree.registerProvider({ ...provider, enrich });

            await tree.getChildren(); // indexes 'a' (as a root child)
            await tree.getChildren(n('a'));
            await tree.getEnrichment(n('a'));

            await tree.invalidateWhere(node => node.id === 'a' ? 'self' : undefined);

            await tree.getEnrichment(n('a'));
            await tree.getChildren(n('a'));

            expect(enrich.mock.callCount()).to.equal(2); // enrichment refreshed
            expect(calls.get('a')).to.equal(1); // children NOT refetched

            tree.dispose();
        });

        it('reconcileRoots re-lists roots while descendant subtrees survive untouched', async () => {
            const tree = new QueryTree<Node>(options());
            const { provider, calls } = countingProvider(
                [n('a'), n('x')],
                { 'a': [n('a/b')], 'a/b': [n('a/b/c')] },
            );
            tree.registerProvider(provider);

            await tree.getChildren();
            await tree.getChildren(n('a'));
            await tree.getChildren(n('a/b'));
            await tree.getChildren(n('a/b/c'));

            await tree.reconcileRoots();

            await tree.getChildren(); // roots re-listed
            await tree.getChildren(n('a/b')); // served from cache -- survivor
            await tree.getChildren(n('a/b/c')); // served from cache -- survivor

            expect(calls.get('<root>')).to.equal(2); // roots refetched
            expect(calls.get('a')).to.equal(1); // survived
            expect(calls.get('a/b')).to.equal(1); // survived
            expect(calls.get('a/b/c')).to.equal(1); // survived

            tree.dispose();
        });

        it('evictSubtreesExcept drops departed roots and prunes their subtree from the index', async () => {
            const tree = new QueryTree<Node>(options());
            const { provider } = countingProvider(
                [n('a'), n('x')],
                { 'a': [n('a/b')], 'x': [n('x/y')] },
            );
            tree.registerProvider(provider);

            await tree.getChildren();
            await tree.getChildren(n('a'));
            await tree.getChildren(n('x'));

            // 'x' is gone from the new root listing; keep only 'a'.
            await tree.evictSubtreesExcept(new Set(['a']));

            expect(tree.get('a')).to.not.equal(undefined);
            expect(tree.get('a/b')).to.not.equal(undefined);
            expect(tree.get('x')).to.equal(undefined);
            expect(tree.get('x/y')).to.equal(undefined);

            tree.dispose();
        });

        it('removeWhere removes matched subtrees (any verdict) and prunes the index', async () => {
            const tree = new QueryTree<Node>(options());
            const { provider } = countingProvider(
                [n('a'), n('x')],
                { 'a': [n('a/b')], 'a/b': [n('a/b/c')] },
            );
            tree.registerProvider(provider);

            await tree.getChildren();
            await tree.getChildren(n('a'));
            await tree.getChildren(n('a/b'));

            await tree.removeWhere(node => node.id === 'a/b' ? 'subtree' : undefined);

            expect(tree.get('a')).to.not.equal(undefined);
            expect(tree.get('a/b')).to.equal(undefined);
            expect(tree.get('a/b/c')).to.equal(undefined);

            tree.dispose();
        });
    });

    // -----------------------------------------------------------------------
    // Tier 3: background enrichment cancel-on-removal.
    // DataItemTree guards against a spurious onDidChange when a node is removed
    // while its enrichment is in flight. Here remove() removes the enrichment
    // query, so a late enrichment result is dropped with no cache event.
    // Mirrors DataItemTree.test.ts "does not fire change after removal".
    // -----------------------------------------------------------------------
    describe('Tier 3: enrichment cancel-on-removal (no spurious fire)', () => {
        it('a removed node fires no change when its in-flight enrichment resolves late', async () => {
            const tree = new QueryTree<Node>(options());
            const enrichResult = deferred<{ label: string }>();
            const provider: QueryTreeProvider<Node> = {
                isRoot: true,
                canHandle: isNode,
                listChildren: () => Promise.resolve([n('a')]),
                enrich: () => enrichResult.promise,
            };
            tree.registerProvider(provider);

            await tree.getChildren(); // indexes 'a'
            const enrichPending = tree.getEnrichment(n('a')).catch(() => undefined); // in-flight
            await delay(5);
            await tree.remove(n('a')); // cancels + removes the enrichment query

            // Subscribe AFTER removal (mirrors the DataItemTree test), so the
            // removal's own events are not counted -- only a *later* spurious fire.
            const listener = mock.fn();
            const sub = tree.onDidChange(listener);

            enrichResult.resolve({ label: 'A' }); // late arrival for a removed node
            await enrichPending;
            await delay(5);

            expect(listener.mock.callCount()).to.equal(0);
            expect(tree.get('a')).to.equal(undefined);

            sub.dispose();
            tree.dispose();
        });
    });
});
