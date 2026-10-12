/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, readText } from '@microsoft/vscode-azure-utils';
import { respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { parse } from 'jsonc-parser';
import { CopyFunctionUrl } from '../../../src/commands/functions/CopyFunctionUrl';
import { ExecuteFunction } from '../../../src/commands/functions/ExecuteFunction';
import { SetFunctionState } from '../../../src/commands/functions/SetFunctionState';
import { isLocalFunctionNode } from '../../../src/tree/workspace/WorkspaceNode';
import { createLocalFunctions } from '../../tree/workspace/functions/mockLocalFunctions';
import { WebAppSettingsAdapter } from '../../../src/settings/adapters/WebAppSettingsAdapter';

describe('Local function commands (integration)', () => {
    let fixtures: ReturnType<typeof createLocalFunctions>[] = [];
    async function setup(ready = true) {
        const s = createLocalFunctions();
        fixtures.push(s);
        s.addProject();
        s.addFunction('Http');
        const metadata = {
            name: 'Http', config: { bindings: [{ type: 'httpTrigger', authLevel: 'function' }] },
            ['invoke_url_template']: 'http://localhost:8090/custom/orders/{id}?mode=local',
        };
        s.host.listFunctions.mock.mockImplementation(() => Promise.resolve([metadata]));
        const registration = ready ? s.hosts.register(s.folder, 8090) : undefined;
        const project = (await s.tree.getChildren())[0];
        const fn = (await s.tree.getChildren(project)).find(isLocalFunctionNode);
        if (!fn) {
            throw new Error('Expected local HTTP function');
        }
        const remote = mock.fn(() => { throw new Error('A local command must not contact Azure'); });
        const remoteSettings = new WebAppSettingsAdapter(s.code, remote);
        const writeClipboard = mock.method(s.code.env.clipboard, 'writeText', (_text: string) => Promise.resolve());
        return { ...s, project, fn, metadata, registration, remote, remoteSettings, writeClipboard };
    }
    afterEach(() => {
        fixtures.forEach(fixture => { fixture.dispose(); });
        fixtures = [];
        mock.restoreAll();
    });

    for (const input of ['', '{"payload":"private"}']) {
        it(`submits exact ${input ? 'nonempty' : 'empty'} local input without persisting it`, async () => {
            const s = await setup();
            const prompts = respondToPrompts(s.m, [{ input }]);
            await new ExecuteFunction(s.context.ctx, s.selector, s.remote, s.createHost, s.target).execute(s.fn.id);
            prompts.assertAllConsumed();
            expect(s.host.invoke.mock.calls[0].arguments).to.deep.equal(['Http', input]);
            const states = [s.context.ctx.extensionContext.workspaceState, s.context.ctx.extensionContext.globalState];
            expect(JSON.stringify(states.flatMap(state => state.keys().map(key => state.get(key))))).not.to.include('private');
            expect(s.remote.mock.callCount()).to.equal(0);
        });
    }

    it('does not invoke a local function when input is cancelled', async () => {
        const s = await setup();
        respondToPrompts(s.m, ['cancel']);
        await expect(new ExecuteFunction(s.context.ctx, s.selector, s.remote, s.createHost, s.target).execute(s.fn.id))
            .to.be.rejectedWith(CancellationError);
        expect(s.host.invoke.mock.callCount()).to.equal(0);
    });

    it('rejects offline execution and stale local keys instead of falling through to remote selection', async () => {
        const s = await setup(false);
        const command = new ExecuteFunction(s.context.ctx, s.selector, s.remote, s.createHost, s.target);
        await expect(command.execute(s.fn.id)).to.be.rejectedWith(/Start debugging/);
        await expect(command.execute(`${s.project.id}/function/Stale`)).to.be.rejectedWith(/Refresh/);
        expect(s.host.invoke.mock.callCount()).to.equal(0);
        expect(s.remote.mock.callCount()).to.equal(0);
    });

    it('requires workspace trust before local invocation, URL reads, or settings writes', async () => {
        const s = await setup();
        mock.property(s.m.workspace, 'isTrusted', false);
        const write = mock.method(s.code.workspace.fs, 'writeFile');
        s.host.listFunctions.mock.resetCalls();
        await expect(new ExecuteFunction(s.context.ctx, s.selector, s.remote, s.createHost, s.target).execute(s.fn.id))
            .to.be.rejectedWith('trusted, non-virtual workspace');
        await expect(new CopyFunctionUrl(s.code, s.selector, s.remote, s.target).execute(s.fn.id))
            .to.be.rejectedWith('trusted, non-virtual workspace');
        const state = new SetFunctionState(s.code, s.selector, s.remoteSettings, s.resourceCache, s.target);
        await expect(state.execute(true, s.fn.id)).to.be.rejectedWith('trusted, non-virtual workspace');
        await expect(state.execute(false, s.fn.id)).to.be.rejectedWith('trusted, non-virtual workspace');
        expect(s.host.invoke.mock.callCount()).to.equal(0);
        expect(s.host.listFunctions.mock.callCount()).to.equal(0);
        expect(write.mock.callCount()).to.equal(0);
        expect(s.remote.mock.callCount()).to.equal(0);
    });

    it('rechecks workspace trust after the invocation input prompt', async () => {
        const s = await setup();
        const prompts = respondToPrompts(s.m, [{ input: 'input' }]);
        const createInputBox = s.code.window.createInputBox;
        mock.method(s.code.window, 'createInputBox', () => {
            const input = createInputBox();
            input.onDidAccept(() => { mock.property(s.m.workspace, 'isTrusted', false); });
            return input;
        });
        await expect(new ExecuteFunction(s.context.ctx, s.selector, s.remote, s.createHost, s.target).execute(s.fn.id))
            .to.be.rejectedWith('trusted, non-virtual workspace');
        prompts.assertAllConsumed();
        expect(s.host.invoke.mock.callCount()).to.equal(0);
    });

    it('restricts direct local host and settings actions to file projects in the open workspace', async () => {
        const s = await setup();
        const write = mock.method(s.code.workspace.fs, 'writeFile');
        for (const uri of [s.code.Uri.parse('virtual:/repo/host.json'), s.code.Uri.file('/outside/host.json')]) {
            const fn = { ...s.fn, project: { ...s.fn.project, resourceUri: uri } };
            expect(() => s.target.host(fn)).to.throw('trusted, non-virtual workspace');
            await expect(s.target.setDisabled(fn, true)).to.be.rejectedWith('trusted, non-virtual workspace');
        }
        expect(write.mock.callCount()).to.equal(0);
    });

    it('copies the live host route template without guessing a route or adding an authentication key', async () => {
        const s = await setup();
        const current = { ...s.metadata, ['invoke_url_template']: 'http://127.0.0.1:8090/changed/{id}?mode=local' };
        s.host.listFunctions.mock.mockImplementation(() => Promise.resolve([current]));
        await new CopyFunctionUrl(s.code, s.selector, s.remote, s.target).execute(s.fn.id);
        expect(s.writeClipboard.mock.calls[0].arguments[0]).to.equal(new URL(current.invoke_url_template).toString());
        expect(s.remote.mock.callCount()).to.equal(0);
    });

    for (const url of [
        'http://example.com:8090/api/Http', 'http://localhost:7071/api/Http',
        'https://localhost:8090/api/Http', 'http://user:password@localhost:8090/api/Http',
        'not-a-url',
    ]) {
        it(`rejects a host invocation URL outside the registered loopback origin (${url.split('@').at(-1)})`, async () => {
            const s = await setup();
            s.host.listFunctions.mock.mockImplementation(() => Promise.resolve([{ ...s.metadata, ['invoke_url_template']: url }]));
            await expect(new CopyFunctionUrl(s.code, s.selector, s.remote, s.target).execute(s.fn.id)).to.be.rejected;
            expect(s.writeClipboard.mock.callCount()).to.equal(0);
        });
    }

    it('rejects a stale HTTP leaf when current host metadata has another trigger', async () => {
        const s = await setup();
        s.host.listFunctions.mock.mockImplementation(() => Promise.resolve([{
            ...s.metadata, config: { bindings: [{ type: 'timerTrigger' }] },
        }]));
        await expect(new CopyFunctionUrl(s.code, s.selector, s.remote, s.target).execute(s.fn.id)).to.be.rejectedWith(/HTTP trigger/);
        expect(s.writeClipboard.mock.callCount()).to.equal(0);
    });

    it('rejects a missing current function or host URL', async () => {
        const s = await setup();
        const command = new CopyFunctionUrl(s.code, s.selector, s.remote, s.target);
        s.host.listFunctions.mock.mockImplementation(() => Promise.resolve([]));
        await expect(command.execute(s.fn.id)).to.be.rejectedWith(/HTTP trigger/);
        s.host.listFunctions.mock.mockImplementation(() => Promise.resolve([{ ...s.metadata, ['invoke_url_template']: undefined }]));
        await expect(command.execute(s.fn.id)).to.be.rejectedWith(/invocation URL/);
    });

    it('edits disable flags without disturbing comments, secrets, Host, or ConnectionStrings', async () => {
        const s = await setup(false);
        const uri = s.code.Uri.joinPath(s.folder, 'local.settings.json');
        const original = [
            '{',
            '    // keep this comment',
            '    "IsEncrypted": false,',
            '    "Values": {"FUNCTIONS_WORKER_RUNTIME":"node", "private":"keep-secret",},',
            '    "Host": {"LocalHttpPort":8090},',
            '    "ConnectionStrings": {"database":"keep-connection"},',
            '}',
        ].join('\r\n');
        s.m.fs.addFile(uri, original);
        const invalidate = mock.method(s.tree, 'invalidate');
        await new SetFunctionState(s.code, s.selector, s.remoteSettings, s.resourceCache, s.target).execute(true, s.fn.id);
        const text = await readText(s.code, uri);
        expect(text).to.include('// keep this comment').and.include('\r\n');
        const data: unknown = parse(text ?? '');
        expect(data).to.deep.equal({
            IsEncrypted: false,
            Values: { ['FUNCTIONS_WORKER_RUNTIME']: 'node', private: 'keep-secret', ['AzureWebJobs.Http.Disabled']: 'true' },
            Host: { LocalHttpPort: 8090 }, ConnectionStrings: { database: 'keep-connection' },
        });
        expect(invalidate.mock.calls[0].arguments[0]).to.equal(s.project);
        expect(s.remote.mock.callCount()).to.equal(0);
        const refreshed = (await s.tree.getChildren(s.project)).find(isLocalFunctionNode);
        expect(refreshed?.isDisabled).to.be.true;
        if (!refreshed) {
            throw new Error('Expected refreshed local function');
        }
        await new SetFunctionState(s.code, s.selector, s.remoteSettings, s.resourceCache, s.target).execute(false, refreshed.id);
        expect((await s.settings.read(s.folder)).values['AzureWebJobs.Http.Disabled']).to.equal('false');
    });

    it('rejects writes to a dirty local settings document', async () => {
        const s = await setup(false);
        const uri = s.code.Uri.joinPath(s.folder, 'local.settings.json');
        const document = await s.code.workspace.openTextDocument(uri);
        Object.assign(document, { isDirty: true });
        const write = mock.method(s.code.workspace.fs, 'writeFile');
        await expect(s.target.setDisabled(s.fn, true)).to.be.rejectedWith(/Save local.settings.json/);
        expect(write.mock.callCount()).to.equal(0);
    });

    for (const text of [
        '{"IsEncrypted":true,"Values":{"private":"ciphertext"}}',
        '{"Values":{"private":5}}', '{"Values":{"same":"one","same":"two"}}',
        '{"Values":{},"Values":{"private":"ambiguous"}}', '{"Values":',
    ]) {
        it(`rejects encrypted or malformed local settings without replacing the file (${text.length})`, async () => {
            const s = await setup(false);
            const uri = s.code.Uri.joinPath(s.folder, 'local.settings.json');
            s.m.fs.addFile(uri, text);
            const write = mock.method(s.code.workspace.fs, 'writeFile');
            await expect(s.target.setDisabled(s.fn, true)).to.be.rejected;
            expect(write.mock.callCount()).to.equal(0);
            expect(await readText(s.code, uri)).to.equal(text);
        });
    }

    it('does not invalidate the tree when a local settings write fails', async () => {
        const s = await setup(false);
        mock.method(s.code.workspace.fs, 'writeFile', () => Promise.reject(new Error('write rejected')));
        const invalidate = mock.method(s.tree, 'invalidate');
        await expect(s.target.setDisabled(s.fn, true)).to.be.rejectedWith('write rejected');
        expect(invalidate.mock.callCount()).to.equal(0);
    });

    it('creates Values for a missing local settings file without copying remote settings', async () => {
        const s = await setup(false);
        const uri = s.code.Uri.joinPath(s.folder, 'local.settings.json');
        await s.code.workspace.fs.delete(uri);
        await s.target.setDisabled(s.fn, true);
        expect((await s.settings.read(s.folder)).values).to.deep.equal({ ['AzureWebJobs.Http.Disabled']: 'true' });
    });
});
