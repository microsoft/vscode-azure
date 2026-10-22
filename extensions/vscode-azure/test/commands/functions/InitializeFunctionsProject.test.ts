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

    it('preserves recommendations and comments without changing existing tasks', async () => {
        const s = setup('python');
        const extensions = s.code.Uri.joinPath(s.folder, '.vscode', 'extensions.json');
        const tasks = s.code.Uri.joinPath(s.folder, '.vscode', 'tasks.json');
        s.m.fs.addFile(extensions, '{ // recommendations\n "recommendations": [/* existing recommendation */ "existing.extension"], "unwantedRecommendations": ["unwanted.extension"] }');
        s.m.fs.addFile(tasks, '{ "tasks": [{ "type": "func" }] }');
        await s.command.execute(s.folder);
        const text = await readText(s.code, extensions);
        expect(text).to.include('// recommendations');
        expect(text).to.include('/* existing recommendation */');
        expect(parse(text ?? '').recommendations).to.include('existing.extension').and.include('ms-python.debugpy');
        expect(parse(text ?? '').unwantedRecommendations).to.deep.equal(['unwanted.extension']);
        expect(await readText(s.code, tasks)).to.equal('{ "tasks": [{ "type": "func" }] }');
    });

    it('initializes a missing runtime and refreshes the cached project node', async () => {
        const s = setup('');
        const nested = s.code.Uri.joinPath(s.folder, 'nested', 'host.json');
        s.m.fs.addFile(nested, '{}');
        const roots = await s.tree.getChildren();
        const [before] = roots;
        const unrelated = roots.find(node => isFunctionsProjectNode(node) && node.resourceUri.toString() === nested.toString());
        expect(unrelated).to.exist;
        expect(isFunctionsProjectNode(before) && before.initialized).to.be.false;
        const prompts = respondToPrompts(s.m, [{ pick: 'node' }]);
        await s.command.execute(s.folder);
        prompts.assertAllConsumed();
        expect((await s.settings.read(s.folder)).values.get('FUNCTIONS_WORKER_RUNTIME')).to.equal('node');
        const refreshed = await s.tree.getChildren();
        const [after] = refreshed;
        expect(refreshed).to.include(unrelated);
        expect(isFunctionsProjectNode(after) && after.initialized).to.be.true;
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
        it(`initializes ${runtime} with base recommendations`, async () => {
            const s = setup(runtime);
            await s.command.execute(s.folder);
            const extensions = parse(await readText(s.code, s.code.Uri.joinPath(s.folder, '.vscode', 'extensions.json')) ?? '');
            expect(extensions.recommendations).to.deep.equal([ExtensionId]);
        });
    }

    for (const [runtime, recommendations] of [
        ['node', []],
        ['python', ['ms-python.python', 'ms-python.debugpy']],
        ['java', ['redhat.java', 'vscjava.vscode-java-debug']],
        ['dotnet-isolated', ['ms-dotnettools.csharp']],
        ['powershell', ['ms-vscode.PowerShell']],
        ['native', ['golang.Go']],
    ] as const) {
        it(`recommends exactly the ${runtime} runtime extensions`, async () => {
            const s = setup(runtime);
            s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'go.mod'), 'module app\n\ngo 1.24\n');
            await s.command.execute(s.folder);
            const extensions = parse(await readText(s.code, s.code.Uri.joinPath(s.folder, '.vscode', 'extensions.json')) ?? '');
            expect(extensions.recommendations).to.deep.equal([ExtensionId, ...recommendations]);
        });
    }

    it('preserves existing extension IDs without adding case-insensitive duplicates', async () => {
        const s = setup('powershell');
        const extensions = s.code.Uri.joinPath(s.folder, '.vscode', 'extensions.json');
        const text = JSON.stringify({ recommendations: [ExtensionId.toUpperCase(), 'ms-vscode.powershell', 'existing.extension'] });
        s.m.fs.addFile(extensions, text);
        const write = mock.method(s.code.workspace.fs, 'writeFile');
        await s.command.execute(s.folder);
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
    ] as const) {
        it(`preserves ${file} when ${key} has invalid ${Array.isArray(value) ? 'entries' : 'type'}`, async () => {
            const s = setup();
            const uri = s.code.Uri.joinPath(s.folder, '.vscode', file);
            const text = JSON.stringify({ [key]: value, custom: 'preserve' });
            s.m.fs.addFile(uri, text);
            const write = mock.method(s.code.workspace.fs, 'writeFile');
            await expect(s.command.execute(s.folder)).to.be.rejectedWith(message);
            expect(write.mock.calls.some(call => call.arguments[0].toString() === uri.toString())).to.be.false;
            expect(await readText(s.code, uri)).to.equal(text);
        });
    }

    it('initializes native Go recommendations', async () => {
        const s = setup('native');
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'go.mod'), 'module app\n\ngo 1.24\n');
        await s.command.execute(s.folder);
        const extensions = parse(await readText(s.code, s.code.Uri.joinPath(s.folder, '.vscode', 'extensions.json')) ?? '');
        expect(extensions.recommendations).to.include('golang.Go');
    });

    it('selects the native worker runtime when initializing an existing Go module', async () => {
        const s = setup('');
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'go.mod'), 'module app\n\ngo 1.24\n');
        const prompts = respondToPrompts(s.m, [{ pick: 'Go (native worker)' }]);
        await s.command.execute(s.folder);
        prompts.assertAllConsumed();
        expect((await s.settings.read(s.folder)).values.get('FUNCTIONS_WORKER_RUNTIME')).to.equal('native');
    });

    it('preserves duplicate-property files and refreshes project state once the file is fixed', async () => {
        const s = setup('');
        const extensions = s.code.Uri.joinPath(s.folder, '.vscode', 'extensions.json');
        s.m.fs.addFile(extensions, '{ "recommendations": [], "recommendations": ["existing"] }');
        respondToPrompts(s.m, [{ pick: 'node' }]);
        await expect(s.command.execute(s.folder)).to.be.rejectedWith('duplicate properties');
        s.m.fs.addFile(extensions, '{}');
        await s.tree.getChildren();
        await s.command.execute(s.folder);
        const [project] = await s.tree.getChildren();
        expect(isFunctionsProjectNode(project) && project.initialized).to.be.true;
    });
});
