/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import {
    isAzdProjectNode, isAzdServiceNode, isEmulatorNode, isEmulatorsGroupNode,
    isFunctionsProjectNode, isWorkspaceNode,
} from '../../../tree/workspace/WorkspaceNode';
import {
    makeAzdProjectNode, makeAzdServiceNode, makeEmulatorNode, makeEmulatorsGroupNode,
    makeFunctionsProjectNode,
} from './mockWorkspaceNode';

describe('WorkspaceNode (unit)', () => {
    describe('isWorkspaceNode', () => {
        it('should return true for any node with id/type/label', () => {
            expect(isWorkspaceNode(makeAzdProjectNode())).to.be.true;
            expect(isWorkspaceNode(makeAzdServiceNode())).to.be.true;
            expect(isWorkspaceNode(makeFunctionsProjectNode())).to.be.true;
            expect(isWorkspaceNode(makeEmulatorsGroupNode())).to.be.true;
            expect(isWorkspaceNode(makeEmulatorNode())).to.be.true;
        });

        it('should return false for null/undefined/primitives', () => {
            expect(isWorkspaceNode(null)).to.be.false;
            expect(isWorkspaceNode(undefined)).to.be.false;
            expect(isWorkspaceNode('string')).to.be.false;
            expect(isWorkspaceNode(42)).to.be.false;
        });

        it('should return false for objects missing required fields', () => {
            expect(isWorkspaceNode({ id: 'x', type: 'azdProject' })).to.be.false; // missing label
            expect(isWorkspaceNode({ id: 'x', label: 'y' })).to.be.false; // missing type
            expect(isWorkspaceNode({ type: 'x', label: 'y' })).to.be.false; // missing id
        });

        it('should require string id and label', () => {
            expect(isWorkspaceNode({ id: 1, type: 'azdProject', label: 'y' })).to.be.false;
            expect(isWorkspaceNode({ id: 'x', type: 'azdProject', label: 7 })).to.be.false;
        });
    });

    describe('variant type guards', () => {
        it('should discriminate azdProject vs azdService', () => {
            expect(isAzdProjectNode(makeAzdProjectNode())).to.be.true;
            expect(isAzdProjectNode(makeAzdServiceNode())).to.be.false;
            expect(isAzdServiceNode(makeAzdServiceNode())).to.be.true;
            expect(isAzdServiceNode(makeAzdProjectNode())).to.be.false;
        });

        it('should discriminate functionsProject', () => {
            expect(isFunctionsProjectNode(makeFunctionsProjectNode())).to.be.true;
            expect(isFunctionsProjectNode(makeAzdProjectNode())).to.be.false;
        });

        it('should discriminate emulatorsGroup vs emulator', () => {
            expect(isEmulatorsGroupNode(makeEmulatorsGroupNode())).to.be.true;
            expect(isEmulatorsGroupNode(makeEmulatorNode())).to.be.false;
            expect(isEmulatorNode(makeEmulatorNode())).to.be.true;
            expect(isEmulatorNode(makeEmulatorsGroupNode())).to.be.false;
        });

        it('should return false for non-nodes', () => {
            expect(isAzdProjectNode(null)).to.be.false;
            expect(isAzdServiceNode(undefined)).to.be.false;
            expect(isFunctionsProjectNode('string')).to.be.false;
            expect(isEmulatorsGroupNode(42)).to.be.false;
            expect(isEmulatorNode({})).to.be.false;
        });
    });
});
