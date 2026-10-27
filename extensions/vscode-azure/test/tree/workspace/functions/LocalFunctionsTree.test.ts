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
        s.startHost([{ name: 'Http' }]);
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

    it('lists host functions directly beneath their own project with stable parentage', async () => {
        const s = setup();
        s.addProject();
        s.startHost([{ name: 'Http' }, { name: 'Timer', config: { bindings: [{ type: 'timerTrigger' }] } }]);
        s.m.fs.addFile(s.code.Uri.file('/repo/nested/host.json'), '{"version":"2.0"}');
        const projects = await s.tree.getChildren();
        expect(projects.map(project => project.label)).to.deep.equal(['repo', 'repo/nested']);
        const functions = await s.tree.getChildren(projects[0]);
        expect(functions.map(fn => fn.label)).to.deep.equal(['Http', 'Timer']);
        expect(functions.every(isLocalFunctionNode)).to.be.true;
        expect((await s.tree.getChildren(projects[1])).map(node => node.type)).to.deep.equal(['functionsHint']);
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

    it('preserves valid siblings beside malformed host metadata', async () => {
        const s = setup();
        s.addProject();
        s.startHost([
            { name: 'Good' },
            { name: 'BadBindings', config: { bindings: [] } },
            { name: 'bad/name' },
            { name: 'bad\\name' },
            { name: ' ' },
            { name: 'Good' },
        ]);
        const project = (await s.tree.getChildren())[0];
        const children = await s.tree.getChildren(project);
        expect(children.filter(isLocalFunctionNode).map(fn => fn.functionName)).to.deep.equal(['Good']);
        const invalid = children.filter(child => child.type === 'invalidLocalFunction');
        expect(invalid).to.have.lengthOf(5);
        for (const node of invalid) {
            const item = s.view.getTreeItem(node.id);
            expect(item.contextValue).to.equal(RefreshWorkspaceView.ContextValue);
            expect(item.description).to.equal('Invalid');
        }
    });

    for (const [hostConfig, message] of [
        [null, 'host.json must contain a JSON object.'],
        [[], 'host.json must contain a JSON object.'],
        [{}, 'Use the host.json version 2.0 schema'],
        [{ version: '1.0' }, 'Use the host.json version 2.0 schema'],
        [{ version: '2.0', functions: 'Http' }, 'host.json functions must be an array of function names.'],
        [{ version: '2.0', functions: ['Http', 3] }, 'host.json functions must be an array of function names.'],
    ] as const) {
        it(`marks a project invalid when host.json reports ${JSON.stringify(hostConfig)}`, async () => {
            const s = setup();
            s.addProject('node', hostConfig);
            const [project] = await s.tree.getChildren();
            expect(s.view.getTreeItem(project.id).description).to.equal('Invalid');
            expect(s.view.getTreeItem(project.id).tooltip).to.include(message);
            expect(s.createHost.mock.callCount()).to.equal(0);
        });
    }

    for (const runtime of ['node', 'dotnet-isolated', 'java']) {
        it(`shows only a start-debugging hint for ${runtime} before the host is ready`, async () => {
            const s = setup();
            s.addProject(runtime);
            const project = (await s.tree.getChildren())[0];
            const nodes = await s.tree.getChildren(project);
            expect(nodes.map(node => node.type)).to.deep.equal(['functionsHint']);
            expect(s.view.getTreeItem(nodes[0].id).contextValue).to.equal(RefreshWorkspaceView.ContextValue);
            expect(s.createHost.mock.callCount()).to.equal(0);
        });
    }

    it('lists functions from the ready host and refreshes to the hint when it stops', async () => {
        const s = setup();
        s.addProject();
        const project = (await s.tree.getChildren())[0];
        expect((await s.tree.getChildren(project))[0].type).to.equal('functionsHint');
        const registration = s.startHost([{ name: 'CodeFirst' }], 8090);
        const functions = await s.tree.getChildren(project);
        expect(functions.map(fn => fn.label)).to.deep.equal(['CodeFirst']);
        expect(s.createHost.mock.calls[0].arguments[0]).to.deep.equal({ port: 8090 });
        const contexts = s.view.getTreeItem(functions[0].id).contextValue?.split(';');
        expect(contexts).to.include(ExecuteFunction.ContextValue).and.include(CopyFunctionUrl.ContextValue);
        registration.dispose();
        const offline = await s.tree.getChildren(project);
        expect(offline[0].type).to.equal('functionsHint');
    });

    it('offers host-dependent commands for functions listed by a ready host', async () => {
        const s = setup();
        s.addProject();
        const other = s.hosts.register(s.code.Uri.file('/repo/other'), 8081);
        const registration = s.startHost([
            { name: 'Http' },
            { name: 'Timer', config: { bindings: [{ type: 'timerTrigger' }] } },
        ], 8080);
        const project = (await s.tree.getChildren())[0];
        const nodes = await s.tree.getChildren(project);
        const http = nodes.find(node => node.label === 'Http');
        const timer = nodes.find(node => node.label === 'Timer');
        if (!http || !timer) {
            throw new Error('Expected HTTP and timer functions');
        }
        expect(s.view.getTreeItem(http.id).contextValue?.split(';')).to.include(SetFunctionState.DisableContextValue).and.include(CopyFunctionUrl.ContextValue);
        expect(s.view.getTreeItem(timer.id).contextValue?.split(';')).to.include(ExecuteFunction.ContextValue).and.not.include(CopyFunctionUrl.ContextValue);
        registration.dispose();
        other.dispose();
    });

    it('refreshes the listing on local settings edits', async () => {
        const s = setup();
        s.addProject();
        s.startHost([{ name: 'Http' }]);
        s.index.onDidChangeIndex(() => { new RefreshWorkspaceView(s.tree).execute(); });
        let project = (await s.tree.getChildren())[0];
        expect((await s.tree.getChildren(project)).find(isLocalFunctionNode)?.isDisabled).to.be.false;
        await s.settings.setDisabled(s.folder, 'Http', true);
        fireFileSystemEvent(s.m, '/repo/local.settings.json');
        await s.scheduler.flush();
        project = (await s.tree.getChildren())[0];
        expect((await s.tree.getChildren(project)).find(isLocalFunctionNode)?.isDisabled).to.be.true;
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
        s.startHost([{ name: 'Selected' }, { name: 'Ignored' }]);
        const project = (await s.tree.getChildren())[0];
        expect((await s.tree.getChildren(project)).map(node => node.label)).to.deep.equal(['Selected']);
    });

    it('honors an empty function filter while allowing unrelated host configuration', async () => {
        const s = setup();
        s.addProject('node', { version: '2.0', functions: [], extensions: { http: { routePrefix: 'custom' } } });
        s.startHost([{ name: 'Http' }]);
        const [project] = await s.tree.getChildren();
        expect(s.view.getTreeItem(project.id).description).to.equal('Azure Functions');
        expect(await s.tree.getChildren(project)).to.be.empty;
    });

    it('reports an invalid function filter changed after discovery and recovers after correction', async () => {
        const s = setup();
        s.addProject();
        s.startHost([{ name: 'Http' }]);
        const [project] = await s.tree.getChildren();
        s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'host.json'), '{"version":"2.0","functions":[false]}');
        const [invalid] = await s.tree.getChildren(project);
        expect(invalid.type).to.equal('invalidLocalFunction');
        expect(s.view.getTreeItem(invalid.id).tooltip).to.include('host.json functions must be an array of function names.');
        expect(s.host.listFunctions.mock.callCount()).to.equal(0);
        s.addProject();
        new RefreshWorkspaceView(s.tree).execute();
        const [refreshed] = await s.tree.getChildren();
        expect((await s.tree.getChildren(refreshed)).map(node => node.label)).to.deep.equal(['Http']);
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

    it('does not advertise a build or debug hint for an authoritative empty host listing', async () => {
        const s = setup();
        s.addProject();
        const registration = s.startHost([]);
        expect(await s.tree.getChildren((await s.tree.getChildren())[0])).to.be.empty;
        registration.dispose();
    });

    it('keeps host registrations separate across workspace roots', async () => {
        const s = setup();
        s.addProject();
        addWorkspaceFolder(s.m, '/other');
        s.m.fs.addFile(s.code.Uri.file('/other/host.json'), '{"version":"2.0"}');
        const projects = await s.tree.getChildren();
        const own = projects.find(project => project.label === 'repo');
        const other = projects.find(project => project.label === 'other');
        if (!own || !other) {
            throw new Error('Expected both workspace projects');
        }
        const registration = s.startHost([{ name: 'HostOnly', config: { bindings: [{ type: 'timerTrigger' }] } }]);
        expect((await s.tree.getChildren(own)).map(node => node.label)).to.deep.equal(['HostOnly']);
        expect((await s.tree.getChildren(other)).map(node => node.type)).to.deep.equal(['functionsHint']);
        registration.dispose();
    });
});
