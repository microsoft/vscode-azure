/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import type { QueryClient } from '@tanstack/query-core';
import { delay } from '../../base/delay';
import { DataItemTree } from '../../tree/DataItemTree';
import type { DataProvider } from '../../tree/DataProvider';
import { Everything, Roots, selfOnly, subtreeOf, type Selector } from '../../tree/Selector';
import type { TreeIndex } from '../../tree/TreeIndex';
import { createTestActionExecutor } from '../createTestActionExecutor';
import { createMockVsCode } from '../vscode/MockVsCode';

interface Res {
    id: string;
    enriched?: boolean;
}

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
const CHILD_MAP = new Map<string, Res[]>([
    ['a', [{ id: 'a1' }, { id: 'a2' }]],
    ['a1', [{ id: 'a1x' }, { id: 'a1y' }]],
    ['a2', [{ id: 'a2x' }]],
    ['b', [{ id: 'b1' }]],
    ['b1', [{ id: 'b1x' }]],
]);

const ROOTS: Res[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

function buildTree(options?: { enrich?: boolean }): DataItemTree<Res> {
    const { executor } = createTestActionExecutor();
    const { vscode } = createMockVsCode();
    const tree = new DataItemTree<Res>(vscode, 'consistency', executor, r => r.id, 60_000);

    tree.registerProvider({
        isRoot: true,
        canHandle: (_r: unknown): _r is Res => false,
        getChildren: () => ROOTS.map(r => ({ ...r })),
    });

    const branch: DataProvider<Res> = {
        isRoot: false,
        canHandle: (r: unknown): r is Res => CHILD_MAP.has((r as Res).id),
        getChildren: (r?: Res) => (r ? (CHILD_MAP.get(r.id) ?? []).map(c => ({ ...c })) : []),
        enrich: options?.enrich
            ? async (r: Res) => { await delay(1); r.enriched = true; return false; }
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
function buildPagedTree(): DataItemTree<Res> {
    const { executor } = createTestActionExecutor();
    const { vscode } = createMockVsCode();
    const tree = new DataItemTree<Res>(vscode, 'consistency-paged', executor, r => r.id, 60_000);
    tree.registerProvider({
        isRoot: true,
        canHandle: (_r: unknown): _r is Res => false,
        getChildren: () => [{ id: 'root' }],
    });
    tree.registerProvider({
        isRoot: false,
        canHandle: (r: unknown): r is Res => (r as Res).id === 'root',
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
function snapshotState(tree: DataItemTree<Res>): {
    indexed: Map<string, readonly string[]>;
    cachedPaths: string[][];
    pagerKeys: string[];
    enrichmentKeys: string[];
} {
    const internals = tree as unknown as DataItemTreeInternals<Res>;
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
function assertConsistent(tree: DataItemTree<Res>, label: string): void {
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

describe('DataItemTree consistency (unit)', () => {
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
                            const selector: Selector<Res> = r => (r.id.includes('a') ? 'subtree' : undefined);
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
        const tree = new DataItemTree<Res>(vscode, 'mass-departure', executor, r => r.id, 60_000);

        const rootCount = 12;
        let roots: Res[] = Array.from({ length: rootCount }, (_v, i) => ({ id: `r${i}` }));
        tree.registerProvider({
            isRoot: true,
            canHandle: (_r: unknown): _r is Res => false,
            getChildren: () => roots.map(r => ({ ...r })),
        });
        // Every root gets two children and each child a grandchild, so a departing
        // root drops a three-node subtree from every store.
        tree.registerProvider({
            isRoot: false,
            canHandle: (r: unknown): r is Res => /^r\d+$/.test((r as Res).id) || /^r\d+c\d$/.test((r as Res).id),
            getChildren: (r?: Res) => {
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
