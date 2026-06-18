/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { FlatNodeStore, type FlatNode } from '../../tree/FlatNodeStore';

interface TestNode extends FlatNode {
    id: string;
}

function makeNode(id: string, childKeys?: string[], parentKey?: string): TestNode {
    return { id, childKeys: childKeys ?? undefined, parentKey };
}

describe('FlatNodeStore (unit)', () => {
    it('should return undefined for unknown keys', () => {
        const store = new FlatNodeStore<TestNode>();
        expect(store.get('missing')).to.be.undefined;
        expect(store.has('missing')).to.be.false;
    });

    it('should store and retrieve nodes by key', () => {
        const store = new FlatNodeStore<TestNode>();
        const node = makeNode('a');
        store.set('a', node);
        expect(store.get('a')).to.equal(node);
        expect(store.has('a')).to.be.true;
    });

    it('should clear all entries and the tag index', () => {
        const store = new FlatNodeStore<TestNode>();
        store.set('a', makeNode('a'));
        store.set('b', makeNode('b'));
        store.tag('a', ['x']);
        store.clear();
        expect(store.get('a')).to.be.undefined;
        expect(store.get('b')).to.be.undefined;
        expect(store.keysForTag('x')).to.be.undefined;
    });

    describe('removeSubtrees', () => {
        it('should remove a node and all its descendants by following childKeys', () => {
            const store = new FlatNodeStore<TestNode>();
            store.set('r', makeNode('r', ['c']));
            store.set('c', makeNode('c', ['gc'], 'r'));
            store.set('gc', makeNode('gc', undefined, 'c'));

            store.removeSubtrees(['r']);

            expect(store.get('r')).to.be.undefined;
            expect(store.get('c')).to.be.undefined;
            expect(store.get('gc')).to.be.undefined;
        });

        it('should not remove unrelated nodes', () => {
            const store = new FlatNodeStore<TestNode>();
            const b = makeNode('b');
            store.set('a', makeNode('a'));
            store.set('b', b);

            store.removeSubtrees(['a']);

            expect(store.get('a')).to.be.undefined;
            expect(store.get('b')).to.equal(b);
        });

        it('should handle undefined childKeys', () => {
            const store = new FlatNodeStore<TestNode>();
            store.set('a', makeNode('a')); // childKeys is undefined

            store.removeSubtrees(['a']);
            expect(store.get('a')).to.be.undefined;
        });

        it('should handle undefined input', () => {
            const store = new FlatNodeStore<TestNode>();
            store.set('a', makeNode('a'));

            store.removeSubtrees(undefined);
            expect(store.get('a')).to.not.be.undefined;
        });

        it('should skip keys that are not present', () => {
            const store = new FlatNodeStore<TestNode>();
            store.set('a', makeNode('a'));

            store.removeSubtrees(['missing', 'a']);
            expect(store.get('a')).to.be.undefined;
        });

        it('should prune tags of every removed node', () => {
            const store = new FlatNodeStore<TestNode>();
            store.set('r', makeNode('r', ['c']));
            store.set('c', makeNode('c', undefined, 'r'));
            store.tag('r', ['account:r']);
            store.tag('c', ['tenant:c']);

            store.removeSubtrees(['r']);

            expect(store.keysForTag('account:r')).to.be.undefined;
            expect(store.keysForTag('tenant:c')).to.be.undefined;
            expect(store.keysForTag(`${FlatNodeStore.ancestorTagPrefix}r`)).to.be.undefined;
        });

        it('should not touch the tag index on clear-by-removal of unrelated nodes', () => {
            const store = new FlatNodeStore<TestNode>();
            store.set('a', makeNode('a'));
            store.set('b', makeNode('b'));
            store.tag('a', ['x']);
            store.tag('b', ['y']);

            store.removeSubtrees(['a']);

            expect(store.keysForTag('x')).to.be.undefined;
            expect([...(store.keysForTag('y') ?? [])]).to.deep.equal(['b']);
        });
    });

    describe('tag', () => {
        it('should derive ancestor tags up the parent chain plus semantic tags', () => {
            const store = new FlatNodeStore<TestNode>();
            store.set('r', makeNode('r', ['c']));
            store.set('c', makeNode('c', ['gc'], 'r'));
            store.set('gc', makeNode('gc', undefined, 'c'));
            store.tag('gc', ['sub:gc']);

            expect([...(store.keysForTag(`${FlatNodeStore.ancestorTagPrefix}c`) ?? [])]).to.deep.equal(['gc']);
            expect([...(store.keysForTag(`${FlatNodeStore.ancestorTagPrefix}r`) ?? [])]).to.deep.equal(['gc']);
            expect([...(store.keysForTag('sub:gc') ?? [])]).to.deep.equal(['gc']);
        });

        it('should leave an untagged root with no ancestors out of the index', () => {
            const store = new FlatNodeStore<TestNode>();
            store.set('r', makeNode('r'));
            store.tag('r', []);

            expect(store.get('r')!.tags).to.be.undefined;
        });

        it('should no-op for a missing key', () => {
            const store = new FlatNodeStore<TestNode>();
            store.tag('missing', ['x']);
            expect(store.keysForTag('x')).to.be.undefined;
        });
    });

    describe('evictByTag', () => {
        function buildTree(): FlatNodeStore<TestNode> {
            // r -> a -> a1, a2 ; r -> b -> b1
            const store = new FlatNodeStore<TestNode>();
            store.set('r', makeNode('r', ['a', 'b']));
            store.set('a', makeNode('a', ['a1', 'a2'], 'r'));
            store.set('a1', makeNode('a1', undefined, 'a'));
            store.set('a2', makeNode('a2', undefined, 'a'));
            store.set('b', makeNode('b', ['b1'], 'r'));
            store.set('b1', makeNode('b1', undefined, 'b'));
            store.tag('r', ['account:r']);
            store.tag('a', ['tenant:a']);
            store.tag('a1', ['sub:a1']);
            store.tag('a2', ['sub:a2']);
            store.tag('b', ['tenant:b']);
            store.tag('b1', ['sub:b1']);
            return store;
        }

        it('should return [] for an unknown tag and leave the store intact', () => {
            const store = buildTree();
            expect(store.evictByTag('nope')).to.deep.equal([]);
            expect(store.has('a')).to.be.true;
        });

        it('should evict a matched node and its whole subtree', () => {
            const store = buildTree();
            const removed = store.evictByTag('tenant:a');

            expect(removed.map(n => n.id).sort()).to.deep.equal(['a', 'a1', 'a2']);
            expect(store.has('a')).to.be.false;
            expect(store.has('a1')).to.be.false;
            expect(store.has('a2')).to.be.false;
            // Siblings under r untouched
            expect(store.has('b')).to.be.true;
            expect(store.has('b1')).to.be.true;
        });

        it('should unlink evicted nodes from a surviving parent childKeys', () => {
            const store = buildTree();
            store.evictByTag('tenant:a');
            expect(store.get('r')!.childKeys).to.deep.equal(['b']);
        });

        it('should leave a removed root for the caller to unlink (parentKey preserved)', () => {
            const store = buildTree();
            const removed = store.evictByTag('account:r');
            // Whole tree gone
            expect(removed.map(n => n.id).sort()).to.deep.equal(['a', 'a1', 'a2', 'b', 'b1', 'r']);
            const root = removed.find(n => n.id === 'r');
            expect(root!.parentKey).to.be.undefined;
        });

        it('should sweep a shared tag across multiple branches', () => {
            const store = buildTree();
            // Tag two subs in different branches with a shared tag
            store.tag('a1', ['shared']);
            store.tag('b1', ['shared']);

            const removed = store.evictByTag('shared');
            expect(removed.map(n => n.id).sort()).to.deep.equal(['a1', 'b1']);
            expect(store.has('a')).to.be.true;
            expect(store.has('b')).to.be.true;
        });

        it('should prune evicted tags from the index', () => {
            const store = buildTree();
            store.evictByTag('tenant:a');
            expect(store.keysForTag('tenant:a')).to.be.undefined;
            expect(store.keysForTag('sub:a1')).to.be.undefined;
            expect(store.keysForTag(`${FlatNodeStore.ancestorTagPrefix}a`)).to.be.undefined;
        });
    });
});
