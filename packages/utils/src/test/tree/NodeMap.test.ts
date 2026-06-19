/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { NodeMap } from '../../tree/NodeMap';

interface TestNode {
    id: string;
    children: TestNode[] | undefined;
    parent?: TestNode | undefined;
}

function makeNode(id: string, children?: TestNode[]): TestNode {
    const node: TestNode = { id, children: children ?? undefined };
    for (const child of children ?? []) {
        child.parent = node;
    }
    return node;
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
    });

    describe('clear', () => {
        it('should reset the root set', () => {
            const map = new NodeMap<TestNode>(n => n.id);
            const node = makeNode('a');
            map.set('a', node);
            map.registerRoot(node);

            map.clear();

            expect([...map.roots()]).to.deep.equal([]);
        });
    });

    describe('roots', () => {
        it('should track registered roots in registration order', () => {
            const map = new NodeMap<TestNode>(n => n.id);
            const a = makeNode('a');
            const b = makeNode('b');
            map.set('a', a);
            map.set('b', b);
            map.registerRoot(a);
            map.registerRoot(b);

            expect([...map.roots()]).to.deep.equal([a, b]);
        });

        it('should be idempotent when a node is registered twice', () => {
            const map = new NodeMap<TestNode>(n => n.id);
            const a = makeNode('a');
            map.set('a', a);
            map.registerRoot(a);
            map.registerRoot(a);

            expect([...map.roots()]).to.deep.equal([a]);
        });

        it('should drop a root removed via removeSubtrees', () => {
            const map = new NodeMap<TestNode>(n => n.id);
            const a = makeNode('a');
            const b = makeNode('b');
            map.set('a', a);
            map.set('b', b);
            map.registerRoot(a);
            map.registerRoot(b);

            map.removeSubtrees([a]);

            expect([...map.roots()]).to.deep.equal([b]);
        });

        it('should leave roots untouched when removing a non-root subtree', () => {
            const map = new NodeMap<TestNode>(n => n.id);
            const child = makeNode('c');
            const root = makeNode('r', [child]);
            map.set('r', root);
            map.set('c', child);
            map.registerRoot(root);

            map.removeSubtrees([child]);

            expect([...map.roots()]).to.deep.equal([root]);
        });
    });
});
