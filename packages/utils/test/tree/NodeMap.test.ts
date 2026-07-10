/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { NodeMap } from '../../src/tree/NodeMap';

interface TestNode {
    id: string;
    children: TestNode[] | undefined;
}

function makeNode(id: string, children?: TestNode[]): TestNode {
    return { id, children: children ?? undefined };
}

describe('NodeMap (unit)', () => {
    it('should return undefined for unknown keys', () => {
        const map = new NodeMap<TestNode>(n => n.id);
        expect(map.get('missing')).to.be.undefined;
    });

    it('should store and retrieve nodes by key', () => {
        const map = new NodeMap<TestNode>(n => n.id);
        const node = makeNode('a');
        map.set('a', node);
        expect(map.get('a')).to.equal(node);
    });

    it('should clear all entries', () => {
        const map = new NodeMap<TestNode>(n => n.id);
        map.set('a', makeNode('a'));
        map.set('b', makeNode('b'));
        map.clear();
        expect(map.get('a')).to.be.undefined;
        expect(map.get('b')).to.be.undefined;
    });

    describe('removeSubtrees', () => {
        it('should remove a node and all its descendants', () => {
            const map = new NodeMap<TestNode>(n => n.id);
            const grandchild = makeNode('gc');
            const child = makeNode('c', [grandchild]);
            const root = makeNode('r', [child]);

            map.set('r', root);
            map.set('c', child);
            map.set('gc', grandchild);

            map.removeSubtrees([root]);

            expect(map.get('r')).to.be.undefined;
            expect(map.get('c')).to.be.undefined;
            expect(map.get('gc')).to.be.undefined;
        });

        it('should not remove unrelated nodes', () => {
            const map = new NodeMap<TestNode>(n => n.id);
            const a = makeNode('a');
            const b = makeNode('b');
            map.set('a', a);
            map.set('b', b);

            map.removeSubtrees([a]);

            expect(map.get('a')).to.be.undefined;
            expect(map.get('b')).to.equal(b);
        });

        it('should handle undefined children', () => {
            const map = new NodeMap<TestNode>(n => n.id);
            const node = makeNode('a'); // children is undefined
            map.set('a', node);

            map.removeSubtrees([node]);
            expect(map.get('a')).to.be.undefined;
        });

        it('should handle undefined input', () => {
            const map = new NodeMap<TestNode>(n => n.id);
            map.set('a', makeNode('a'));

            map.removeSubtrees(undefined);
            expect(map.get('a')).to.not.be.undefined;
        });

        describe('return value (evicted keys)', () => {
            it('should return the keys of the node and all its descendants', () => {
                const map = new NodeMap<TestNode>(n => n.id);
                const grandchild = makeNode('gc');
                const child = makeNode('c', [grandchild]);
                const root = makeNode('r', [child]);

                map.set('r', root);
                map.set('c', child);
                map.set('gc', grandchild);

                const removed = map.removeSubtrees([root]);

                expect(removed).to.have.members(['r', 'c', 'gc']);
                expect(removed).to.have.lengthOf(3);
            });

            it('should return descendants before their ancestor', () => {
                const map = new NodeMap<TestNode>(n => n.id);
                const grandchild = makeNode('gc');
                const child = makeNode('c', [grandchild]);
                const root = makeNode('r', [child]);

                map.set('r', root);
                map.set('c', child);
                map.set('gc', grandchild);

                const removed = map.removeSubtrees([root]);

                // A node's descendants are always evicted before the node itself,
                // so side tables can be cleaned bottom-up.
                expect(removed.indexOf('gc')).to.be.lessThan(removed.indexOf('c'));
                expect(removed.indexOf('c')).to.be.lessThan(removed.indexOf('r'));
            });

            it('should return the keys of every input subtree', () => {
                const map = new NodeMap<TestNode>(n => n.id);
                const aChild = makeNode('a-c');
                const a = makeNode('a', [aChild]);
                const b = makeNode('b');
                const unrelated = makeNode('z');

                map.set('a', a);
                map.set('a-c', aChild);
                map.set('b', b);
                map.set('z', unrelated);

                const removed = map.removeSubtrees([a, b]);

                expect(removed).to.have.members(['a', 'a-c', 'b']);
                expect(removed).to.not.include('z');
            });

            it('should return a single key for a childless node', () => {
                const map = new NodeMap<TestNode>(n => n.id);
                const node = makeNode('a'); // children is undefined
                map.set('a', node);

                expect(map.removeSubtrees([node])).to.deep.equal(['a']);
            });

            it('should return an empty array for undefined input', () => {
                const map = new NodeMap<TestNode>(n => n.id);
                expect(map.removeSubtrees(undefined)).to.deep.equal([]);
            });

            it('should return an empty array for empty input', () => {
                const map = new NodeMap<TestNode>(n => n.id);
                expect(map.removeSubtrees([])).to.deep.equal([]);
            });
        });
    });
});
