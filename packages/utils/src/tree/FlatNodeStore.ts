/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The minimal shape a node must expose to live in a {@linkcode FlatNodeStore}.
 *
 * Parent / child relationships are expressed purely as **string keys**, never
 * as object references. This is what makes the store "flat": re-listing a level
 * (e.g. accounts) and re-using the same keys keeps every parent/child link
 * valid without any object-identity reconciliation, because nothing points at
 * the replaced objects -- they point at keys.
 *
 * @internal
 */
export interface FlatNode {
    /** Key of this node's parent, or `undefined` for root nodes. */
    parentKey: string | undefined;

    /**
     * Ordered keys of this node's cached children, or `undefined` when the
     * children have not been loaded yet. An empty array means "loaded, no
     * children".
     */
    childKeys: string[] | undefined;

    /**
     * Tags carried by this node: the structural `ancestor:<key>` tag for every
     * ancestor (derived by {@linkcode FlatNodeStore.tag}) plus any semantic
     * identity tags the owner supplied. Maintained by the store -- owners pass
     * only the semantic tags to {@linkcode FlatNodeStore.tag} and never mutate
     * this field directly. `undefined` means the node carries no tags.
     */
    tags?: string[];
}

/**
 * A flat, string-keyed store of tree nodes with a built-in tag reverse index.
 *
 * The store owns two pieces of structural state:
 *
 * 1. The single `Map<string, TNode>` that resolves keys to nodes. The hierarchy
 *    lives entirely in the string keys on each node
 *    ({@linkcode FlatNode.parentKey} / {@linkcode FlatNode.childKeys}); owners
 *    (e.g. {@linkcode DataItemTree}) mutate `childKeys` / `parentKey` directly
 *    and keep their own auxiliary state (roots list, event emitter).
 * 2. A tag reverse index (`Map<tag, Set<nodeKey>>`) built from the
 *    auto-derived `ancestor:<key>` structural tags plus owner-supplied semantic
 *    tags. This powers {@linkcode evictByTag}: a broad, key-set-only subtree
 *    eviction that never walks child links and never touches `TNode` semantics.
 *
 * The store is deliberately ignorant of resources, providers, TTL, and change
 * events: it answers structural questions ("what carries this tag", "evict this
 * subtree") and leaves the policy/event reactions to its owner.
 *
 * @typeParam TNode - The node type stored in the map. Must satisfy
 *   {@linkcode FlatNode}.
 * @internal
 */
export class FlatNodeStore<TNode extends FlatNode> {
    /**
     * Prefix for the auto-derived structural tag that every node carries for
     * each of its ancestors. A node beneath ancestor `K` carries
     * `ancestor:<K>`, so the entire subtree rooted at `K` (excluding `K`
     * itself) is exactly `keysForTag('ancestor:' + K)` -- a flat lookup with
     * no child-link walking.
     */
    public static readonly ancestorTagPrefix = 'ancestor:';

    private readonly map = new Map<string, TNode>();

    /**
     * Reverse index mapping a tag to the set of node keys carrying it. Includes
     * both owner-supplied semantic tags and the auto-derived `ancestor:<key>`
     * structural tags. Kept consistent as nodes are tagged ({@linkcode tag})
     * and removed ({@linkcode delete} / {@linkcode removeSubtrees} /
     * {@linkcode evictByTag} / {@linkcode clear}).
     */
    private readonly tagIndex = new Map<string, Set<string>>();

    /** Get a node by key. */
    public get(key: string): TNode | undefined {
        return this.map.get(key);
    }

    /** Whether a node with the given key is present. */
    public has(key: string): boolean {
        return this.map.has(key);
    }

    /** Set a node by key. Does not tag the node; call {@linkcode tag} after. */
    public set(key: string, node: TNode): void {
        this.map.set(key, node);
    }

    /**
     * Compute and register the tags for an already-stored node: the structural
     * `ancestor:<key>` tag for every ancestor (walked via
     * {@linkcode FlatNode.parentKey}, so the node must already be in the store
     * with its `parentKey` set) plus the given semantic tags. Sets
     * {@linkcode FlatNode.tags} and updates the reverse index.
     *
     * Idempotency is the caller's responsibility: this appends, so it should be
     * called exactly once per freshly-created node. A node with no ancestors
     * and no semantic tags is left untagged.
     *
     * @param key - Key of the node to tag (must already be present).
     * @param semanticTags - Owner-supplied identity tags (e.g. `account:<id>`).
     */
    public tag(key: string, semanticTags: readonly string[]): void {
        const node = this.map.get(key);
        if (!node) {
            return;
        }

        const tags: string[] = [];
        let ancestorKey = node.parentKey;
        while (ancestorKey !== undefined) {
            tags.push(`${FlatNodeStore.ancestorTagPrefix}${ancestorKey}`);
            ancestorKey = this.map.get(ancestorKey)?.parentKey;
        }
        for (const semanticTag of semanticTags) {
            tags.push(semanticTag);
        }

        if (tags.length === 0) {
            return;
        }
        node.tags = tags;
        for (const tag of tags) {
            this.addToTagIndex(tag, key);
        }
    }

    /** The set of node keys currently carrying the given tag, if any. */
    public keysForTag(tag: string): ReadonlySet<string> | undefined {
        return this.tagIndex.get(tag);
    }

    /** Remove all entries (nodes and tag index). */
    public clear(): void {
        this.map.clear();
        this.tagIndex.clear();
    }

    /**
     * Recursively remove the nodes with the given keys and all their
     * descendants from the store, discovered by following each node's
     * {@linkcode FlatNode.childKeys} (children-first). Each removed node's tags
     * are pruned from the reverse index.
     *
     * Keys that are not present are skipped. This does **not** unlink the
     * removed keys from any surviving parent's `childKeys`; callers that need
     * that (e.g. removing a single item) splice the parent list themselves.
     */
    public removeSubtrees(keys: Iterable<string> | undefined): void {
        if (!keys) {
            return;
        }
        for (const key of keys) {
            const node = this.map.get(key);
            if (!node) {
                continue;
            }
            this.removeSubtrees(node.childKeys);
            this.pruneTags(key, node);
            this.map.delete(key);
        }
    }

    /**
     * Hard-evict every node carrying the given tag, *plus* every node beneath
     * those nodes, computed purely from the tag index (no child-link walking):
     * the directly-matched nodes union the contents of `ancestor:<matchedKey>`
     * for each match. Each evicted node is unlinked from any surviving parent's
     * `childKeys`, has its tags pruned, and is deleted from the store.
     *
     * Root unlinking (a removed node whose `parentKey` is `undefined`) and any
     * change-event reaction are the caller's responsibility -- the returned
     * array carries every removed node (with its `parentKey` intact) so the
     * caller can reconcile its own auxiliary state (roots list, event scope).
     *
     * Resilient to unknown tags (returns `[]`) and to a tag carried by many
     * nodes.
     *
     * @param tag - The tag to evict by (semantic or `ancestor:<key>`).
     * @returns The removed nodes, in no particular order.
     */
    public evictByTag(tag: string): TNode[] {
        const seeds = this.tagIndex.get(tag);
        if (!seeds || seeds.size === 0) {
            return [];
        }

        // Expand to the full removal set: each matched node plus every node
        // carrying its `ancestor:<key>` tag (i.e. its whole subtree).
        const removeSet = new Set<string>();
        const stack = [...seeds];
        while (stack.length > 0) {
            const key = stack.pop()!; // eslint-disable-line @typescript-eslint/no-non-null-assertion -- guarded by length check
            if (removeSet.has(key)) {
                continue;
            }
            removeSet.add(key);
            const descendants = this.tagIndex.get(`${FlatNodeStore.ancestorTagPrefix}${key}`);
            if (descendants) {
                for (const descendant of descendants) {
                    if (!removeSet.has(descendant)) {
                        stack.push(descendant);
                    }
                }
            }
        }

        // Evict every node, unlinking it from any surviving parent's childKeys
        // first (root unlinking is left to the caller).
        const removed: TNode[] = [];
        for (const key of removeSet) {
            const node = this.map.get(key);
            if (!node) {
                continue;
            }
            const parentKey = node.parentKey;
            if (parentKey !== undefined && !removeSet.has(parentKey)) {
                const parent = this.map.get(parentKey);
                const childIdx = parent?.childKeys?.indexOf(key) ?? -1;
                if (parent && childIdx !== -1) {
                    parent.childKeys!.splice(childIdx, 1); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- indexOf succeeded
                }
            }
            this.pruneTags(key, node);
            this.map.delete(key);
            removed.push(node);
        }
        return removed;
    }

    /** Remove a node's tags from the reverse index and clear its `tags`. */
    private pruneTags(key: string, node: TNode): void {
        if (!node.tags) {
            return;
        }
        for (const tag of node.tags) {
            this.removeFromTagIndex(tag, key);
        }
        node.tags = undefined;
    }

    private addToTagIndex(tag: string, key: string): void {
        let set = this.tagIndex.get(tag);
        if (!set) {
            set = new Set<string>();
            this.tagIndex.set(tag, set);
        }
        set.add(key);
    }

    private removeFromTagIndex(tag: string, key: string): void {
        const set = this.tagIndex.get(tag);
        if (set) {
            set.delete(key);
            if (set.size === 0) {
                this.tagIndex.delete(tag);
            }
        }
    }
}
