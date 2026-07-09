/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { TreeIndex } from '../../tree/TreeIndex';

interface Res {
    id: string;
    label?: string;
}

function res(id: string, label?: string): Res {
    return { id, label };
}

/**
 * Build a small fixture tree:
 *
 * ```
 * (root)
 *  |- r1
 *  |   |- a
 *  |   |   `- a1
 *  |   `- b
 *  `- r2
 *      `- c
 * ```
 */
function makeTree(): { tree: TreeIndex<Res>; nodes: Record<string, Res> } {
    const nodes = {
        r1: res('r1'), r2: res('r2'),
        a: res('a'), b: res('b'), a1: res('a1'), c: res('c'),
    };
    const tree = new TreeIndex<Res>(r => r.id);
    tree.indexChildren([], [nodes.r1, nodes.r2]);
    tree.indexChildren(['r1'], [nodes.a, nodes.b]);
    tree.indexChildren(['r1', 'a'], [nodes.a1]);
    tree.indexChildren(['r2'], [nodes.c]);
    return { tree, nodes };
}

describe('TreeIndex (unit)', () => {
    describe('get / has / pathOf', () => {
        it('should return the indexed resource by key', () => {
            const { tree, nodes } = makeTree();
            expect(tree.get('a')).to.equal(nodes.a);
        });

        it('should report presence via has', () => {
            const { tree } = makeTree();
            expect(tree.has('a')).to.be.true;
            expect(tree.has('missing')).to.be.false;
        });

        it('should return undefined for unknown keys', () => {
            const { tree } = makeTree();
            expect(tree.get('missing')).to.be.undefined;
            expect(tree.pathOf('missing')).to.be.undefined;
        });

        it('should record the full path (root -> node, inclusive)', () => {
            const { tree } = makeTree();
            expect(tree.pathOf('r1')).to.deep.equal(['r1']);
            expect(tree.pathOf('a')).to.deep.equal(['r1', 'a']);
            expect(tree.pathOf('a1')).to.deep.equal(['r1', 'a', 'a1']);
        });
    });

    describe('entries', () => {
        it('should iterate every indexed [key, resource] pair', () => {
            const { tree, nodes } = makeTree();
            const seen = new Map([...tree.entries()]);
            expect([...seen.keys()]).to.have.members(['r1', 'r2', 'a', 'b', 'a1', 'c']);
            expect(seen.get('a')).to.equal(nodes.a);
        });
    });

    describe('indexChildren', () => {
        it('should overwrite the resource for an existing key', () => {
            const { tree } = makeTree();
            const updated = res('a', 'enriched');
            tree.indexChildren(['r1'], [updated]);
            expect(tree.get('a')).to.equal(updated);
            expect(tree.get('a')?.label).to.equal('enriched');
        });
    });

    describe('reconcile', () => {
        it('should report no departures when the child set is unchanged', () => {
            const { tree, nodes } = makeTree();
            const { departed } = tree.reconcile(['r1'], [nodes.a, nodes.b]);
            expect(departed).to.deep.equal([]);
            expect(tree.directChildKeys(['r1'])).to.have.members(['a', 'b']);
        });

        it('should report a child that departed the set', () => {
            const { tree, nodes } = makeTree();
            const { departed } = tree.reconcile(['r1'], [nodes.a]);
            expect(departed).to.deep.equal(['b']);
        });

        it('should report every direct child when the new set is empty', () => {
            const { tree } = makeTree();
            const { departed } = tree.reconcile(['r1'], []);
            expect(departed).to.have.members(['a', 'b']);
        });

        it('should report no departures for brand-new children only', () => {
            const { tree, nodes } = makeTree();
            const { departed } = tree.reconcile(['r2'], [nodes.c, res('d')]);
            expect(departed).to.deep.equal([]);
            expect(tree.directChildKeys(['r2'])).to.have.members(['c', 'd']);
            expect(tree.pathOf('d')).to.deep.equal(['r2', 'd']);
        });

        it('should index the surviving and new children while leaving departed nodes indexed', () => {
            const { tree, nodes } = makeTree();
            const { departed } = tree.reconcile(['r1'], [nodes.a, res('e')]);
            expect(departed).to.deep.equal(['b']);
            // The new set is indexed...
            expect(tree.has('a')).to.be.true;
            expect(tree.pathOf('e')).to.deep.equal(['r1', 'e']);
            // ...but the departed node (and its subtree) is left for the caller to
            // evict, so its path / descendants are still resolvable.
            expect(tree.has('b')).to.be.true;
            expect(tree.pathOf('a1')).to.deep.equal(['r1', 'a', 'a1']);
        });

        it('should only consider direct children, not deeper descendants, as departed', () => {
            const { tree, nodes } = makeTree();
            // Re-listing r1's children without touching a1 (a grandchild) must not
            // treat a1 as departed.
            const { departed } = tree.reconcile(['r1'], [nodes.a, nodes.b]);
            expect(departed).to.deep.equal([]);
        });

        it('should treat every root as departed when reconciling an empty root set', () => {
            const { tree } = makeTree();
            const { departed } = tree.reconcile([], []);
            expect(departed).to.have.members(['r1', 'r2']);
        });
    });

    describe('directChildKeys', () => {
        it('should return the root keys for the empty path', () => {
            const { tree } = makeTree();
            expect(tree.directChildKeys([])).to.have.members(['r1', 'r2']);
        });

        it('should return only direct children, not deeper descendants', () => {
            const { tree } = makeTree();
            expect(tree.directChildKeys(['r1'])).to.have.members(['a', 'b']);
            expect(tree.directChildKeys(['r1'])).to.not.include('a1');
        });

        it('should return an empty array for a leaf', () => {
            const { tree } = makeTree();
            expect(tree.directChildKeys(['r1', 'a', 'a1'])).to.deep.equal([]);
        });
    });

    describe('descendantKeys', () => {
        it('should return every strict descendant', () => {
            const { tree } = makeTree();
            expect(tree.descendantKeys(['r1'])).to.have.members(['a', 'b', 'a1']);
        });

        it('should not include the node itself', () => {
            const { tree } = makeTree();
            expect(tree.descendantKeys(['r1'])).to.not.include('r1');
        });

        it('should scope to the given subtree', () => {
            const { tree } = makeTree();
            expect(tree.descendantKeys(['r1', 'a'])).to.deep.equal(['a1']);
            expect(tree.descendantKeys(['r2'])).to.deep.equal(['c']);
        });
    });

    describe('apexes', () => {
        it('should drop a key nested under another matched key', () => {
            const { tree } = makeTree();
            expect(tree.apexes(['a', 'a1'])).to.deep.equal(['a']);
        });

        it('should keep siblings (neither is an ancestor of the other)', () => {
            const { tree } = makeTree();
            expect(tree.apexes(['a', 'b'])).to.have.members(['a', 'b']);
        });

        it('should collapse a deep match under its matched root', () => {
            const { tree } = makeTree();
            expect(tree.apexes(['r1', 'a', 'a1', 'c'])).to.have.members(['r1', 'c']);
        });

        it('should ignore unknown keys', () => {
            const { tree } = makeTree();
            expect(tree.apexes(['a', 'missing'])).to.deep.equal(['a']);
        });
    });

    describe('hasAncestorIn', () => {
        it('should be true when a direct or transitive ancestor is in the set', () => {
            const { tree } = makeTree();
            expect(tree.hasAncestorIn('a1', new Set(['a']))).to.be.true;
            expect(tree.hasAncestorIn('a1', new Set(['r1']))).to.be.true;
        });

        it('should be false when only the node itself is in the set', () => {
            const { tree } = makeTree();
            expect(tree.hasAncestorIn('a1', new Set(['a1']))).to.be.false;
        });

        it('should be false for a root (no ancestors) and for unrelated keys', () => {
            const { tree } = makeTree();
            expect(tree.hasAncestorIn('r1', new Set(['r2']))).to.be.false;
            expect(tree.hasAncestorIn('a', new Set(['b']))).to.be.false;
        });

        it('should be false for unknown keys', () => {
            const { tree } = makeTree();
            expect(tree.hasAncestorIn('missing', new Set(['r1']))).to.be.false;
        });
    });

    describe('parentResourceOf', () => {
        it('should return the parent resource', () => {
            const { tree, nodes } = makeTree();
            expect(tree.parentResourceOf('a')).to.equal(nodes.r1);
            expect(tree.parentResourceOf('a1')).to.equal(nodes.a);
        });

        it('should return undefined for a root', () => {
            const { tree } = makeTree();
            expect(tree.parentResourceOf('r1')).to.be.undefined;
        });

        it('should return undefined for an unknown key', () => {
            const { tree } = makeTree();
            expect(tree.parentResourceOf('missing')).to.be.undefined;
        });
    });

    describe('evict', () => {
        it('should drop a single key without cascading to descendants', () => {
            const { tree } = makeTree();
            tree.evict('a');
            expect(tree.has('a')).to.be.false;
            expect(tree.pathOf('a')).to.be.undefined;
            // evict is a single-key primitive; subtree eviction is caller policy.
            expect(tree.has('a1')).to.be.true;
        });
    });

    describe('clear', () => {
        it('should remove every entry', () => {
            const { tree } = makeTree();
            tree.clear();
            expect([...tree.entries()]).to.deep.equal([]);
            expect(tree.has('r1')).to.be.false;
        });
    });
});
