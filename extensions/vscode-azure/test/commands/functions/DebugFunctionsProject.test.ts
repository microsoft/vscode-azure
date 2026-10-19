/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { DebugFunctionsProject } from '../../../src/commands/functions/DebugFunctionsProject';
import { FunctionsDebugType } from '../../../src/functions/debug/functionsDebug';
import { createLocalFunctions } from '../../tree/workspace/functions/mockLocalFunctions';

describe('Debug Functions project (integration)', () => {
    const fixtures: ReturnType<typeof createLocalFunctions>[] = [];
    function setup() {
        const s = createLocalFunctions();
        s.addProject();
        fixtures.push(s);
        return { ...s, command: new DebugFunctionsProject(s.code, s.projects) };
    }
    afterEach(() => {
        fixtures.splice(0).forEach(s => { s.dispose(); });
        mock.restoreAll();
    });

    for (const targetKind of ['uri', 'tree'] as const) {
        it(`starts the product debugger for a nested project selected by ${targetKind}`, async () => {
            const s = setup();
            const nested = s.code.Uri.joinPath(s.folder, 'nested');
            s.m.fs.addFile(s.code.Uri.joinPath(nested, 'host.json'), '{}');
            const project = (await s.tree.getChildren()).find(node => node.resourceUri?.toString() === s.code.Uri.joinPath(nested, 'host.json').toString());
            if (!project) { throw new Error('Expected the nested Functions project.'); }
            await s.command.execute(targetKind === 'uri' ? nested : project.id);
            expect(s.m.debug.startDebugging.mock.calls[0].arguments).to.deep.equal([
                s.code.workspace.getWorkspaceFolder(nested),
                {
                    type: FunctionsDebugType, request: 'launch',
                    name: 'Debug Azure Functions', projectPath: nested.fsPath,
                },
            ]);
            expect(s.context.ctx.extensionContext.workspaceState.get('functions.lastDebugProject')).to.equal(nested.toString());
        });
    }

    it('starts the project chosen from a multi-project workspace when no target is supplied', async () => {
        const s = setup();
        const nested = s.code.Uri.joinPath(s.folder, 'nested');
        s.m.fs.addFile(s.code.Uri.joinPath(nested, 'host.json'), '{}');
        const prompts = respondToPrompts(s.m, [{ pick: nested.fsPath }]);
        await s.command.execute();
        prompts.assertAllConsumed();
        expect(s.m.debug.startDebugging.mock.calls[0].arguments[1]).to.have.property('projectPath', nested.fsPath);
    });

    it('rejects an untrusted project before starting a debug session', async () => {
        const s = setup();
        mock.property(s.m.workspace, 'isTrusted', false);
        await expect(s.command.execute(s.folder)).to.be.rejectedWith('trusted, non-virtual workspace');
        expect(s.m.debug.startDebugging.mock.callCount()).to.equal(0);
    });

    it('propagates debugger launch failures to the command caller', async () => {
        const s = setup();
        s.m.debug.startDebugging.mock.mockImplementation(() => Promise.reject(new Error('Debugger launch failed.')));
        await expect(s.command.execute(s.folder)).to.be.rejectedWith('Debugger launch failed.');
    });
});
