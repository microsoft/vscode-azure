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
    tags?: string[];
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

        it('should prune tags of every removed node', () => {
            const map = new NodeMap<TestNode>(n => n.id);
            const child = makeNode('c');
            const root = makeNode('r', [child]);
            map.set('r', root);
            map.set('c', child);
            map.registerTags(root, ['account:r']);
            map.registerTags(child, ['tenant:c']);

            map.removeSubtrees([root]);

            expect(map.nodesForTag('account:r')).to.be.undefined;
            expect(map.nodesForTag('tenant:c')).to.be.undefined;
        });

        it('should leave the tags of unrelated nodes intact', () => {
            const map = new NodeMap<TestNode>(n => n.id);
            const a = makeNode('a');
            const b = makeNode('b');
            map.set('a', a);
            map.set('b', b);
            map.registerTags(a, ['x']);
            map.registerTags(b, ['y']);

            map.removeSubtrees([a]);

            expect(map.nodesForTag('x')).to.be.undefined;
            expect([...(map.nodesForTag('y') ?? [])]).to.deep.equal([b]);
        });
    });

    describe('registerTags', () => {
        it('should index a node under each of its semantic tags', () => {
            const map = new NodeMap<TestNode>(n => n.id);
            const node = makeNode('a');
            map.set('a', node);
            map.registerTags(node, ['account:a', 'kind:acct']);

            expect(node.tags).to.deep.equal(['account:a', 'kind:acct']);
            expect([...(map.nodesForTag('account:a') ?? [])]).to.deep.equal([node]);
            expect([...(map.nodesForTag('kind:acct') ?? [])]).to.deep.equal([node]);
        });

        it('should leave a node with no semantic tags out of the index', () => {
            const map = new NodeMap<TestNode>(n => n.id);
            const node = makeNode('a');
            map.set('a', node);
            map.registerTags(node, []);

            expect(node.tags).to.be.undefined;
        });

        it('should group multiple nodes under a shared tag', () => {
            const map = new NodeMap<TestNode>(n => n.id);
            const a = makeNode('a');
            const b = makeNode('b');
            map.set('a', a);
            map.set('b', b);
            map.registerTags(a, ['shared']);
            map.registerTags(b, ['shared']);

            expect([...(map.nodesForTag('shared') ?? [])].sort((x, y) => x.id.localeCompare(y.id))).to.deep.equal([a, b]);
        });
    });

    describe('evictByTag', () => {
        function buildTree(): { map: NodeMap<TestNode>; nodes: Record<string, TestNode> } {
            // r -> a -> a1, a2 ; r -> b -> b1
            const map = new NodeMap<TestNode>(n => n.id);
            const a1 = makeNode('a1');
            const a2 = makeNode('a2');
            const a = makeNode('a', [a1, a2]);
            const b1 = makeNode('b1');
            const b = makeNode('b', [b1]);
            const r = makeNode('r', [a, b]);
            const nodes = { r, a, a1, a2, b, b1 };
            for (const [id, node] of Object.entries(nodes)) {
                map.set(id, node);
            }
            map.registerTags(r, ['account:r']);
            map.registerTags(a, ['tenant:a']);
            map.registerTags(a1, ['sub:a1']);
            map.registerTags(a2, ['sub:a2']);
            map.registerTags(b, ['tenant:b']);
            map.registerTags(b1, ['sub:b1']);
            return { map, nodes };
        }

        it('should return [] for an unknown tag and leave the map intact', () => {
            const { map } = buildTree();
            expect(map.evictByTag('nope')).to.deep.equal([]);
            expect(map.get('a')).to.not.be.undefined;
        });

        it('should evict a matched node and its whole subtree', () => {
            const { map } = buildTree();
            const removed = map.evictByTag('tenant:a');

            expect(removed.map(n => n.id).sort()).to.deep.equal(['a', 'a1', 'a2']);
            expect(map.get('a')).to.be.undefined;
            expect(map.get('a1')).to.be.undefined;
            expect(map.get('a2')).to.be.undefined;
            // Siblings under r untouched
            expect(map.get('b')).to.not.be.undefined;
            expect(map.get('b1')).to.not.be.undefined;
        });

        it('should unlink evicted nodes from a surviving parent children array', () => {
            const { map, nodes } = buildTree();
            map.evictByTag('tenant:a');
            expect(nodes.r.children).to.deep.equal([nodes.b]);
        });

        it('should leave a removed root for the caller to unlink (parent preserved)', () => {
            const { map } = buildTree();
            const removed = map.evictByTag('account:r');
            // Whole tree gone
            expect(removed.map(n => n.id).sort()).to.deep.equal(['a', 'a1', 'a2', 'b', 'b1', 'r']);
            const root = removed.find(n => n.id === 'r');
            expect(root?.parent).to.be.undefined;
        });

        it('should sweep a shared tag across multiple branches', () => {
            const { map, nodes } = buildTree();
            // Tag two subs in different branches with a shared tag
            map.registerTags(nodes.a1, ['shared']);
            map.registerTags(nodes.b1, ['shared']);

            const removed = map.evictByTag('shared');
            expect(removed.map(n => n.id).sort()).to.deep.equal(['a1', 'b1']);
            expect(map.get('a')).to.not.be.undefined;
            expect(map.get('b')).to.not.be.undefined;
        });

        it('should prune evicted tags from the index', () => {
            const { map } = buildTree();
            map.evictByTag('tenant:a');
            expect(map.nodesForTag('tenant:a')).to.be.undefined;
            expect(map.nodesForTag('sub:a1')).to.be.undefined;
        });
    });

    describe('clear', () => {
        it('should reset the tag index', () => {
            const map = new NodeMap<TestNode>(n => n.id);
            const node = makeNode('a');
            map.set('a', node);
            map.registerTags(node, ['x']);

            map.clear();

            expect(map.nodesForTag('x')).to.be.undefined;
        });
    });
});
