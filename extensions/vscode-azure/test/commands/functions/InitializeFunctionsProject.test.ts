/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readText } from '@microsoft/vscode-azure-utils';
import { respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { parse } from 'jsonc-parser';
import { mock } from 'node:test';
import { ExtensionId } from '../../../src/constants';
import { InitializeFunctionsProject } from '../../../src/commands/functions/InitializeFunctionsProject';
import { createLocalFunctions } from '../../tree/workspace/functions/mockLocalFunctions';
import { isFunctionsProjectNode } from '../../../src/tree/workspace/WorkspaceNode';
import { DebugFunctionsProject } from '../../../src/commands/functions/DebugFunctionsProject';

describe('Initialize Functions project (integration)', () => {
    const fixtures: ReturnType<typeof createLocalFunctions>[] = [];
    function setup(runtime = 'node') {
        const s = createLocalFunctions();
        s.addProject(runtime);
        fixtures.push(s);
        const command = new InitializeFunctionsProject(s.context.ctx, s.projects, s.settings, s.tree);
        return { ...s, command };
    }
    afterEach(() => { fixtures.splice(0).forEach(s => { s.dispose(); }); mock.restoreAll(); });

    it('preserves recommendations and comments and offers a launch entry without changing existing tasks', async () => {
        const s = setup('python');
        const extensions = s.code.Uri.joinPath(s.folder, '.vscode', 'extensions.json');
        const launch = s.code.Uri.joinPath(s.folder, '.vscode', 'launch.json');
        const tasks = s.code.Uri.joinPath(s.folder, '.vscode', 'tasks.json');
        s.m.fs.addFile(extensions, '{ // recommendations\n "recommendations": [/* existing recommendation */ "existing.extension"], "unwantedRecommendations": ["unwanted.extension"] }');
        s.m.fs.addFile(launch, '{ // launch options\n "version":"0.2.0", "configurations":[{ /* existing debugger */ "type":"node","name":"existing","request":"launch"}], "compounds":[] }');
        s.m.fs.addFile(tasks, '{ "tasks": [{ "type": "func" }] }');
        const prompts = respondToPrompts(s.m, [{ button: 'Add launch.json Configuration' }]);
        await s.command.execute(s.folder);
        prompts.assertAllConsumed();
        const text = await readText(s.code, extensions);
        expect(text).to.include('// recommendations');
        expect(text).to.include('/* existing recommendation */');
        expect(parse(text ?? '').recommendations).to.include('existing.extension').and.include('ms-python.debugpy');
        expect(parse(text ?? '').unwantedRecommendations).to.deep.equal(['unwanted.extension']);
        const launchText = await readText(s.code, launch);
        expect(launchText).to.include('// launch options');
        expect(launchText).to.include('/* existing debugger */');
        expect(parse(launchText ?? '').configurations).to.have.length(2);
        expect(parse(launchText ?? '').configurations[1].projectPath).to.equal(s.folder.fsPath);
        expect(await readText(s.code, tasks)).to.equal('{ "tasks": [{ "type": "func" }] }');
    });

    it('initializes a missing runtime and writes a runnable optional configuration without duplicates', async () => {
        const s = setup('');
        const nested = s.code.Uri.joinPath(s.folder, 'nested', 'host.json');
        s.m.fs.addFile(nested, '{}');
        const roots = await s.tree.getChildren();
        const [before] = roots;
        const unrelated = roots.find(node => isFunctionsProjectNode(node) && node.resourceUri.toString() === nested.toString());
        expect(unrelated).to.exist;
        expect(isFunctionsProjectNode(before) && before.initialized).to.be.false;
        const first = respondToPrompts(s.m, [{ pick: 'node' }, { button: 'Add launch.json Configuration' }]);
        await s.command.execute(s.folder);
        first.assertAllConsumed();
        expect((await s.settings.read(s.folder)).values.get('FUNCTIONS_WORKER_RUNTIME')).to.equal('node');
        const refreshed = await s.tree.getChildren();
        const [after] = refreshed;
        expect(refreshed).to.include(unrelated);
        expect(isFunctionsProjectNode(after) && after.initialized).to.be.true;
        expect(s.view.getTreeItem(after.id).contextValue).to.include(DebugFunctionsProject.ContextValue);
        const next = respondToPrompts(s.m, [{ button: 'Add launch.json Configuration' }]);
        await s.command.execute(s.folder);
        next.assertAllConsumed();
        const launch = parse(await readText(s.code, s.code.Uri.joinPath(s.folder, '.vscode', 'launch.json')) ?? '');
        expect(launch.configurations).to.have.length(1);
        expect(launch.configurations[0].type).to.equal('azure-functions');
        expect(launch.configurations[0].request).to.equal('launch');
    });

    it('refuses malformed or dirty workspace files rather than replacing user edits', async () => {
        const s = setup();
        const extensions = s.code.Uri.joinPath(s.folder, '.vscode', 'extensions.json');
        s.m.fs.addFile(extensions, '{ invalid');
        await expect(s.command.execute(s.folder)).to.be.rejectedWith('valid JSON object');
        expect(await readText(s.code, extensions)).to.equal('{ invalid');
        s.m.fs.addFile(extensions, '{}');
        const document = await s.code.workspace.openTextDocument(extensions);
        mock.property(document, 'isDirty', true);
        await expect(s.command.execute(s.folder)).to.be.rejectedWith('Save');
        expect(await readText(s.code, extensions)).to.equal('{}');
    });

    for (const runtime of ['custom', 'constructor']) {
        it(`initializes ${runtime} with base recommendations and explains supported debugging runtimes`, async () => {
            const s = setup(runtime);
            await s.command.execute(s.folder);
            expect(s.m.window.showInformationMessage.mock.calls[0].arguments[0]).to.include('Local debugging supports');
            const extensions = parse(await readText(s.code, s.code.Uri.joinPath(s.folder, '.vscode', 'extensions.json')) ?? '');
            expect(extensions.recommendations).to.deep.equal([ExtensionId]);
        });
    }

    it('preserves existing extension IDs without adding case-insensitive duplicates', async () => {
        const s = setup('powershell');
        const extensions = s.code.Uri.joinPath(s.folder, '.vscode', 'extensions.json');
        const text = JSON.stringify({ recommendations: [ExtensionId.toUpperCase(), 'ms-vscode.powershell', 'existing.extension'] });
        s.m.fs.addFile(extensions, text);
        const write = mock.method(s.code.workspace.fs, 'writeFile');
        const prompts = respondToPrompts(s.m, ['cancel']);
        await s.command.execute(s.folder);
        prompts.assertAllConsumed();
        expect(write.mock.callCount()).to.equal(0);
        expect(await readText(s.code, extensions)).to.equal(text);
    });

    it('requires go.mod for native worker initialization before editing workspace files', async () => {
        const s = setup('native');
        const write = mock.method(s.code.workspace.fs, 'writeFile');
        await expect(s.command.execute(s.folder)).to.be.rejectedWith('Native worker initialization requires a Go Functions project with go.mod.');
        expect(write.mock.callCount()).to.equal(0);
    });

    for (const [file, key, value, message] of [
        ['extensions.json', 'recommendations', {}, 'recommendations must be an array of extension IDs'],
        ['extensions.json', 'recommendations', ['existing.extension', 5], 'recommendations must be an array of extension IDs'],
        ['launch.json', 'configurations', {}, 'configurations must be an array of configuration objects'],
        ['launch.json', 'configurations', ['invalid'], 'configurations must be an array of configuration objects'],
    ] as const) {
        it(`preserves ${file} when ${key} has invalid ${Array.isArray(value) ? 'entries' : 'type'}`, async () => {
            const s = setup();
            const uri = s.code.Uri.joinPath(s.folder, '.vscode', file);
            const text = JSON.stringify({ [key]: value, custom: 'preserve' });
            s.m.fs.addFile(uri, text);
            if (key === 'configurations') {
                respondToPrompts(s.m, [{ button: 'Add launch.json Configuration' }]);
            }
            const write = mock.method(s.code.workspace.fs, 'writeFile');
            await expect(s.command.execute(s.folder)).to.be.rejectedWith(message);
            expect(write.mock.calls.some(call => call.arguments[0].toString() === uri.toString())).to.be.false;
            expect(await readText(s.code, uri)).to.equal(text);
        });
    }

    it('initializes native Go recommendations and exposes F5 in the workspace tree', async () => {
        const s = setup('native');
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'go.mod'), 'module app\n\ngo 1.24\n');
        const prompts = respondToPrompts(s.m, [{ button: 'Add launch.json Configuration' }]);
        await s.command.execute(s.folder);
        prompts.assertAllConsumed();
        const extensions = parse(await readText(s.code, s.code.Uri.joinPath(s.folder, '.vscode', 'extensions.json')) ?? '');
        expect(extensions.recommendations).to.include('golang.Go');
        const launch = parse(await readText(s.code, s.code.Uri.joinPath(s.folder, '.vscode', 'launch.json')) ?? '');
        expect(launch.configurations[0].type).to.equal('azure-functions');
        const [project] = await s.tree.getChildren();
        expect(s.view.getTreeItem(project.id).contextValue).to.include(DebugFunctionsProject.ContextValue);
    });

    it('selects the native worker runtime when initializing an existing Go module', async () => {
        const s = setup('');
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'go.mod'), 'module app\n\ngo 1.24\n');
        const prompts = respondToPrompts(s.m, [{ pick: 'Go (native worker)' }, 'cancel']);
        await s.command.execute(s.folder);
        prompts.assertAllConsumed();
        expect((await s.settings.read(s.folder)).values.get('FUNCTIONS_WORKER_RUNTIME')).to.equal('native');
    });

    it('preserves duplicate-property files and refreshes project state when the optional launch offer is dismissed', async () => {
        const s = setup('');
        const extensions = s.code.Uri.joinPath(s.folder, '.vscode', 'extensions.json');
        s.m.fs.addFile(extensions, '{ "recommendations": [], "recommendations": ["existing"] }');
        respondToPrompts(s.m, [{ pick: 'node' }]);
        await expect(s.command.execute(s.folder)).to.be.rejectedWith('duplicate properties');
        s.m.fs.addFile(extensions, '{}');
        await s.tree.getChildren();
        respondToPrompts(s.m, ['cancel']);
        await s.command.execute(s.folder);
        const [project] = await s.tree.getChildren();
        expect(isFunctionsProjectNode(project) && project.initialized).to.be.true;
    });
});
