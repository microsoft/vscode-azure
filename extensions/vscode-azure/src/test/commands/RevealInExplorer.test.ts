/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { Mock } from 'node:test';
import { RevealInExplorer } from '../../commands/RevealInExplorer';
import { makeAzdProjectNode, makeAzdServiceNode } from '../tree/workspace/mockWorkspaceNode';

describe('RevealInExplorer (unit)', () => {
    function setUp(node?: unknown) {
        const m = createMockVsCode();
        const dataTree = { get: () => node } as never;
        return { code: m.vscode, executeCommand: m.commands.executeCommand as unknown as Mock<(...args: unknown[]) => unknown>, cmd: new RevealInExplorer(m.vscode, dataTree) };
    }

    it('forwards resourceUri to VS Code revealInExplorer when present', async () => {
        const node = makeAzdProjectNode();
        const { cmd, executeCommand } = setUp(node);

        await cmd.execute(node.id);
        expect(executeCommand.mock.callCount()).to.equal(1);
        const [commandId, arg] = executeCommand.mock.calls[0].arguments;
        expect(commandId).to.equal('revealInExplorer');
        expect(arg).to.equal(node.resourceUri);
    });

    it('is a no-op for nodes without a resourceUri', async () => {
        const node = makeAzdServiceNode(); // no resourceUri
        const { cmd, executeCommand } = setUp(node);

        await cmd.execute(node.id);
        expect(executeCommand.mock.callCount()).to.equal(0);
    });

    it('is a no-op when the node is missing from the data tree', async () => {
        const { cmd, executeCommand } = setUp(undefined);

        await cmd.execute('azwr://azdProject/missing');
        expect(executeCommand.mock.callCount()).to.equal(0);
    });
});
