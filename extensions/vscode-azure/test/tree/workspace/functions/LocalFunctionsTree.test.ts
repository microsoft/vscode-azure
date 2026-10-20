/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addWorkspaceFolder, fireFileSystemEvent } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { CopyFunctionUrl } from '../../../../src/commands/functions/CopyFunctionUrl';
import { ExecuteFunction } from '../../../../src/commands/functions/ExecuteFunction';
import { SetFunctionState } from '../../../../src/commands/functions/SetFunctionState';
import { RefreshWorkspaceView } from '../../../../src/commands/tree/RefreshWorkspaceView';
import { isFunctionsProjectNode, isLocalFunctionNode } from '../../../../src/tree/workspace/WorkspaceNode';
import { createLocalFunctions } from './mockLocalFunctions';

describe('Local Functions tree (integration)', () => {
    let fixtures: ReturnType<typeof createLocalFunctions>[] = [];
    function setup() {
        const fixture = createLocalFunctions();
        fixtures.push(fixture);
        return fixture;
    }
    afterEach(() => {
        fixtures.forEach(fixture => { fixture.dispose(); });
        fixtures = [];
        mock.restoreAll();
    });

    it('reads runtime and disabled state from mixed-case local setting names', async () => {
        const s = setup();
        s.addProject();
        s.addFunction('Http');
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'local.settings.json'), JSON.stringify({
            Values: { ['functions_worker_runtime']: 'node', ['azurewebjobs.HTTP.disabled']: 'true' },
        }));

        const project = (await s.tree.getChildren())[0];
        const fn = (await s.tree.getChildren(project)).find(isLocalFunctionNode);

        expect(isFunctionsProjectNode(project) && project.runtime).to.equal('node');
        expect(isFunctionsProjectNode(project) && project.initialized).to.be.true;
        if (!fn) { throw new Error('Expected a local function'); }
        expect(fn.isDisabled).to.be.true;
        expect(s.view.getTreeItem(fn.id).contextValue?.split(';')).to.include(SetFunctionState.EnableContextValue);
    });

    it('lists script functions directly beneath their own project with stable parentage', async () => {
        const s = setup();
        s.addProject();
        s.addFunction('Http');
        s.addFunction('Timer', { bindings: [{ type: 'timerTrigger' }] });
        s.m.fs.addFile(s.code.Uri.file('/repo/nested/host.json'), '{"version":"2.0"}');
        s.addFunction('ProjectFile', { bindings: [{ type: 'httpTrigger' }] }, 'nested');
        s.addFunction('Nested', { bindings: [{ type: 'httpTrigger' }] }, 'nested/Nested');
        const projects = await s.tree.getChildren();
        expect(projects.map(project => project.label)).to.deep.equal(['repo', 'repo/nested']);
        const functions = await s.tree.getChildren(projects[0]);
        expect(functions.map(fn => fn.label)).to.deep.equal(['Http', 'Timer']);
        expect(functions.every(isLocalFunctionNode)).to.be.true;
        expect(await s.view.getChildren(projects[0].id)).to.deep.equal(functions.map(fn => fn.id));
        for (const fn of functions) {
            expect(s.view.getParent(fn.id)).to.equal(projects[0].id);
            expect(await s.tree.getChildren(fn)).to.be.empty;
        }
        const ids = functions.map(fn => fn.id);
        new RefreshWorkspaceView(s.tree).execute();
        const refreshed = (await s.tree.getChildren())[0];
        expect((await s.tree.getChildren(refreshed)).map(fn => fn.id)).to.deep.equal(ids);
    });

    it('preserves valid siblings beside malformed JSON and malformed bindings', async () => {
        const s = setup();
        s.addProject();
        s.addFunction('Good');
        s.addFunction('BadBindings', { bindings: [] });
        const bad = s.addFunction('BadJson');
        s.m.fs.addFile(bad, '{"private":"secret-string", broken}');
        const project = (await s.tree.getChildren())[0];
        const children = await s.tree.getChildren(project);
        expect(children.filter(isLocalFunctionNode).map(fn => fn.functionName)).to.deep.equal(['Good']);
        const invalid = children.filter(child => child.type === 'invalidLocalFunction');
        expect(invalid).to.have.lengthOf(2);
        for (const node of invalid) {
            const item = s.view.getTreeItem(node.id);
            expect(item.contextValue).to.equal(RefreshWorkspaceView.ContextValue);
            expect(item.description).to.equal('Invalid');
            expect(item.tooltip).not.to.include('secret-string');
        }
    });

    it('reads .NET isolated metadata from generated output and retains the build hint', async () => {
        const s = setup();
        s.addProject('dotnet-isolated');
        s.m.fs.addFile(s.code.Uri.file('/repo/App.csproj'), '<Project />');
        s.m.fs.addFile(s.code.Uri.file('/repo/bin/Debug/net8.0/functions.metadata'), JSON.stringify([
            { name: 'BuiltHttp', bindings: [{ type: 'httpTrigger', authLevel: 'anonymous' }] },
            { name: 'BuiltTimer', bindings: [{ type: 'timerTrigger' }] },
            { name: 'Broken', bindings: [] },
        ]));
        s.m.fs.addFile(s.code.Uri.file('/repo/bin/Debug/net8.0/runtimes/unix/native/dependencies/ignored.dll'), '');
        const project = (await s.tree.getChildren())[0];
        const nodes = await s.tree.getChildren(project);
        expect(nodes.filter(isLocalFunctionNode).map(fn => fn.functionName)).to.deep.equal(['BuiltHttp', 'BuiltTimer']);
        expect(nodes.some(node => node.type === 'invalidLocalFunction')).to.be.true;
        expect(nodes.at(-1)?.type).to.equal('functionsHint');
        expect(await s.view.getChildren()).to.deep.equal([project.id]);
    });

    it('shows a build hint before precompiled output exists without treating it as a failed project', async () => {
        const s = setup();
        s.addProject('dotnet-isolated');
        const project = (await s.tree.getChildren())[0];
        const nodes = await s.tree.getChildren(project);
        expect(nodes).to.have.lengthOf(1);
        expect(nodes[0].type).to.equal('functionsHint');
        expect(s.view.getTreeItem(nodes[0].id).contextValue).to.equal(RefreshWorkspaceView.ContextValue);
    });

    it('reads Java generated function.json files under the packaged app rather than dependency folders', async () => {
        const s = setup();
        s.addProject('java');
        s.m.fs.addFile(s.code.Uri.file('/repo/pom.xml'), '<project />');
        s.m.fs.addFile(s.code.Uri.file('/repo/target/azure-functions/app/host.json'), '{"version":"2.0"}');
        s.addFunction('JavaHttp', { bindings: [{ type: 'httpTrigger' }] }, 'target/azure-functions/app/JavaHttp');
        s.addFunction('Unrelated', { bindings: [{ type: 'httpTrigger' }] }, 'target/azure-functions/app/lib/Unrelated');
        const project = (await s.tree.getChildren())[0];
        const nodes = await s.tree.getChildren(project);
        expect(nodes.filter(isLocalFunctionNode).map(node => node.functionName)).to.deep.equal(['JavaHttp']);
        expect(nodes.at(-1)?.type).to.equal('functionsHint');
    });

    it('reports ambiguous Java outputs explicitly', async () => {
        const s = setup();
        s.addProject('java');
        s.m.fs.addFile(s.code.Uri.file('/repo/target/azure-functions/one/host.json'), '{}');
        s.m.fs.addFile(s.code.Uri.file('/repo/target/azure-functions/two/host.json'), '{}');
        const nodes = await s.tree.getChildren((await s.tree.getChildren())[0]);
        expect(nodes[0].type).to.equal('invalidLocalFunction');
        expect(s.view.getTreeItem(nodes[0].id).tooltip).to.include('Multiple Java build outputs');
    });

    it('uses the ready host for code-first projects and refreshes to the offline hint when it stops', async () => {
        const s = setup();
        s.addProject();
        const project = (await s.tree.getChildren())[0];
        expect((await s.tree.getChildren(project))[0].type).to.equal('functionsHint');
        s.host.listFunctions.mock.mockImplementation(() => Promise.resolve([
            { name: 'CodeFirst', config: { bindings: [{ type: 'httpTrigger' }] } },
        ]));
        const registration = s.hosts.register(s.folder, 8090);
        const functions = await s.tree.getChildren(project);
        expect(functions.map(fn => fn.label)).to.deep.equal(['CodeFirst']);
        expect(s.createHost.mock.calls[0].arguments[0]).to.deep.equal({ port: 8090 });
        const contexts = s.view.getTreeItem(functions[0].id).contextValue?.split(';');
        expect(contexts).to.include(ExecuteFunction.ContextValue).and.include(CopyFunctionUrl.ContextValue);
        registration.dispose();
        const offline = await s.tree.getChildren(project);
        expect(offline[0].type).to.equal('functionsHint');
    });

    it('offers state editing offline and host-dependent commands only while the owning host is ready', async () => {
        const s = setup();
        s.addProject();
        s.addFunction('Http');
        s.addFunction('Timer', { bindings: [{ type: 'timerTrigger' }] });
        const project = (await s.tree.getChildren())[0];
        const nodes = await s.tree.getChildren(project);
        const http = nodes.find(node => node.label === 'Http');
        const timer = nodes.find(node => node.label === 'Timer');
        if (!http || !timer) {
            throw new Error('Expected HTTP and timer functions');
        }
        expect(s.view.getTreeItem(http.id).contextValue?.split(';')).to.include(SetFunctionState.DisableContextValue);
        expect(s.view.getTreeItem(http.id).contextValue?.split(';')).not.to.include(ExecuteFunction.ContextValue);
        const other = s.hosts.register(s.code.Uri.file('/repo/other'), 8081);
        expect(s.view.getTreeItem(http.id).contextValue?.split(';')).not.to.include(CopyFunctionUrl.ContextValue);
        const registration = s.hosts.register(s.folder, 8080);
        s.host.listFunctions.mock.mockImplementation(() => Promise.resolve([
            { name: 'Http', config: { bindings: [{ type: 'httpTrigger' }] } },
            { name: 'Timer', config: { bindings: [{ type: 'timerTrigger' }] } },
        ]));
        await s.tree.getChildren(project);
        expect(s.view.getTreeItem(http.id).contextValue?.split(';')).to.include(CopyFunctionUrl.ContextValue);
        expect(s.view.getTreeItem(timer.id).contextValue?.split(';')).to.include(ExecuteFunction.ContextValue);
        expect(s.view.getTreeItem(timer.id).contextValue?.split(';')).not.to.include(CopyFunctionUrl.ContextValue);
        registration.dispose();
        other.dispose();
    });

    it('refreshes on source metadata edits, settings edits, generated output, and directory deletion', async () => {
        const s = setup();
        s.addProject();
        const file = s.addFunction('Http');
        s.index.onDidChangeIndex(() => { new RefreshWorkspaceView(s.tree).execute(); });
        let project = (await s.tree.getChildren())[0];
        expect((await s.tree.getChildren(project)).find(isLocalFunctionNode)?.isDisabled).to.be.false;
        await s.settings.setDisabled(s.folder, 'Http', true);
        fireFileSystemEvent(s.m, '/repo/local.settings.json');
        await s.scheduler.flush();
        project = (await s.tree.getChildren())[0];
        expect((await s.tree.getChildren(project)).find(isLocalFunctionNode)?.isDisabled).to.be.true;
        s.m.fs.addFile(file, JSON.stringify({ bindings: [{ type: 'timerTrigger' }] }));
        fireFileSystemEvent(s.m, file.fsPath);
        await s.scheduler.flush();
        project = (await s.tree.getChildren())[0];
        expect((await s.tree.getChildren(project)).find(isLocalFunctionNode)?.triggerKind).to.equal('timerTrigger');
        const invalidate = mock.method(s.tree, 'invalidate');
        fireFileSystemEvent(s.m, '/repo/bin', 'delete');
        await s.outputScheduler.flush();
        expect(invalidate.mock.callCount()).to.be.greaterThan(0);
    });

    it('renders invalid project state without leaking malformed settings text and recovers on refresh', async () => {
        const s = setup();
        s.addProject();
        s.m.fs.addFile(s.code.Uri.file('/repo/local.settings.json'), '{"Values":{"secret":"never-log-this",');
        const project = (await s.tree.getChildren())[0];
        expect(s.view.getTreeItem(project.id).contextValue).to.equal(RefreshWorkspaceView.ContextValue);
        expect(s.view.getTreeItem(project.id).tooltip).not.to.include('never-log-this');
        s.addProject('node');
        new RefreshWorkspaceView(s.tree).execute();
        const recovered = (await s.tree.getChildren())[0];
        expect(isFunctionsProjectNode(recovered)).to.be.true;
        expect(s.view.getTreeItem(recovered.id).description).not.to.equal('Invalid');
    });

    it('shows missing worker runtime without exposing an unimplemented initialization command', async () => {
        const s = setup();
        s.addProject('');
        const project = (await s.tree.getChildren())[0];
        expect(s.view.getTreeItem(project.id).description).to.equal('Worker runtime not configured');
    });

    it('filters function names through host.json without adding a local grouping node', async () => {
        const s = setup();
        s.addProject('node', { version: '2.0', functions: ['Selected'] });
        s.addFunction('Selected');
        s.addFunction('Ignored');
        const project = (await s.tree.getChildren())[0];
        expect((await s.tree.getChildren(project)).map(node => node.label)).to.deep.equal(['Selected']);
    });

    it('retains replacement host registrations when an old host owner stops', () => {
        const s = setup();
        const changed = mock.fn();
        s.hosts.onDidChange(changed);
        const old = s.hosts.register(s.folder, 7001);
        const current = s.hosts.register(s.folder, 7002);
        old.dispose();
        expect(s.hosts.get(s.folder)?.port).to.equal(7002);
        current.dispose();
        expect(s.hosts.get(s.folder)).to.be.undefined;
        expect(changed.mock.callCount()).to.equal(3);
        expect(() => s.hosts.register(s.folder, 0)).to.throw(/port/);
    });

    it('uses live runtime settings when cached project metadata describes another runtime', async () => {
        const s = setup();
        const project = s.addProject('dotnet-isolated');
        s.addFunction('ScriptHttp');
        s.addProject('node');
        const uri = s.code.Uri.file('/repo/ScriptHttp/function.json');
        expect((await s.reader.functions(project, [uri], 'dotnet')).filter(isLocalFunctionNode).map(fn => fn.functionName))
            .to.deep.equal(['ScriptHttp']);
    });

    it('does not invalidate unrelated projects when generated output changes', async () => {
        const s = setup();
        s.addProject();
        s.m.fs.addFile(s.code.Uri.file('/repo/other/host.json'), '{}');
        const projects = await s.tree.getChildren();
        const invalidate = mock.method(s.tree, 'invalidate');
        fireFileSystemEvent(s.m, '/repo/other/bin/Debug/functions.metadata');
        await s.outputScheduler.flush();
        expect(invalidate.mock.calls.map(call => call.arguments[0])).to.deep.equal([projects[1]]);
    });

    it('reports excessive generated-output depth instead of silently hiding potential metadata', async () => {
        const s = setup();
        s.addProject('dotnet-isolated');
        s.m.fs.addFile(s.code.Uri.file('/repo/bin/a/b/c/d/e/functions.metadata'), '[]');
        const nodes = await s.tree.getChildren((await s.tree.getChildren())[0]);
        expect(nodes[0].type).to.equal('invalidLocalFunction');
        expect(s.view.getTreeItem(nodes[0].id).tooltip).to.include('nested too deeply');
    });

    it('does not advertise a build or debug hint for an authoritative empty host listing', async () => {
        const s = setup();
        s.addProject();
        const registration = s.hosts.register(s.folder, 8090);
        expect(await s.tree.getChildren((await s.tree.getChildren())[0])).to.be.empty;
        registration.dispose();
    });

    it('keeps functions, disable flags, and host registrations separate across workspace roots', async () => {
        const s = setup();
        s.addProject();
        s.addFunction('Http');
        addWorkspaceFolder(s.m, '/other');
        s.m.fs.addFile(s.code.Uri.file('/other/host.json'), '{}');
        s.m.fs.addFile(s.code.Uri.file('/other/Http/function.json'), '{"bindings":[{"type":"httpTrigger"}]}');
        s.m.fs.addFile(s.code.Uri.file('/other/local.settings.json'), '{"Values":{"AzureWebJobs.Http.Disabled":"true"}}');
        const projects = await s.tree.getChildren();
        const own = projects.find(project => project.label === 'repo');
        const other = projects.find(project => project.label === 'other');
        if (!own || !other) {
            throw new Error('Expected both workspace projects');
        }
        expect((await s.tree.getChildren(own)).find(isLocalFunctionNode)?.isDisabled).to.be.false;
        expect((await s.tree.getChildren(other)).find(isLocalFunctionNode)?.isDisabled).to.be.true;
        s.host.listFunctions.mock.mockImplementation(() => Promise.resolve([
            { name: 'HostOnly', config: { bindings: [{ type: 'timerTrigger' }] } },
        ]));
        const registration = s.hosts.register(s.folder, 8090);
        expect((await s.tree.getChildren(own)).map(node => node.label)).to.deep.equal(['HostOnly']);
        expect((await s.tree.getChildren(other)).map(node => node.label)).to.deep.equal(['Http']);
        registration.dispose();
    });

    it('refreshes compiled functions when output is added and when its directory is removed', async () => {
        const s = setup();
        s.addProject('dotnet-isolated');
        const project = (await s.tree.getChildren())[0];
        expect((await s.tree.getChildren(project))[0].type).to.equal('functionsHint');
        s.m.fs.addFile(s.code.Uri.file('/repo/bin/Debug/net8.0/functions.metadata'), JSON.stringify([
            { name: 'Generated', bindings: [{ type: 'httpTrigger' }] },
        ]));
        fireFileSystemEvent(s.m, '/repo/bin/Debug/net8.0/functions.metadata', 'create');
        await s.outputScheduler.flush();
        expect((await s.tree.getChildren(project)).find(isLocalFunctionNode)?.functionName).to.equal('Generated');
        await s.code.workspace.fs.delete(s.code.Uri.file('/repo/bin'), { recursive: true });
        fireFileSystemEvent(s.m, '/repo/bin', 'delete');
        await s.outputScheduler.flush();
        expect((await s.tree.getChildren(project)).map(node => node.type)).to.deep.equal(['functionsHint']);
    });
});
