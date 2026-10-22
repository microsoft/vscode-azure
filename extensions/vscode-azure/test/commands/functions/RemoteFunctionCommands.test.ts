/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type FunctionsHostTarget } from '@microsoft/vscode-azure-azutils';
import { createMockFunctionsHostClient, createMockWebAppClient, makeFunctionEnvelope } from '@microsoft/vscode-azure-azutils/testing';
import { CancellationError } from '@microsoft/vscode-azure-utils';
import { mock } from 'node:test';
import { CopyFunctionUrl } from '../../../src/commands/functions/CopyFunctionUrl';
import { FunctionUrlResolver } from '../../../src/functions/FunctionUrlResolver';
import { DeleteFunction } from '../../../src/commands/functions/DeleteFunction';
import { ExecuteFunction } from '../../../src/commands/functions/ExecuteFunction';
import { RevealFunctionAppIdentity } from '../../../src/commands/functions/RevealFunctionAppIdentity';
import { RevealResource } from '../../../src/commands/tree/RevealResource';
import { SetFunctionState } from '../../../src/commands/functions/SetFunctionState';
import { StreamFunctionLogs } from '../../../src/commands/functions/StreamFunctionLogs';
import { WebAppSettingsAdapter } from '../../../src/settings/adapters/WebAppSettingsAdapter';
import { GenericActivityDataProvider } from '../../../src/tree/activity/GenericActivityDataProvider';
import { createTestResourceSelector } from '../../tree/resources/testResourceSelector';
import { makeFunctionAppFunction } from '../../tree/resources/webApp/mockFunctionApp';
import { createFunctionLogs } from '../../tree/resources/webApp/mockFunctionLogs';
import { respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { createLocalFunctions } from '../../tree/workspace/functions/mockLocalFunctions';

let localFixtures: ReturnType<typeof createLocalFunctions>[] = [];
function setup(authLevel: string | undefined = 'function', isTrusted = true) {
    const fn = makeFunctionAppFunction({ authLevel });
    const app = fn.azureResource;
    const selection = createTestResourceSelector({ nodes: [app, fn] });
    const code = selection.codeContext.mock.vscode;
    const client = createMockWebAppClient({
        defaultHostName: 'my-functions.azurewebsites.net',
        settings: { Existing: 'preserved', [`AzureWebJobs.${fn.functionName}.Disabled`]: 'true' },
        functions: [makeFunctionEnvelope({
            invokeUrlTemplate: 'https://my-functions.azurewebsites.net/api/HttpTrigger?code=stale&Code=other&custom=value',
            config: { bindings: [{ type: 'httpTrigger', authLevel }] },
        })],
    });
    const settings = new WebAppSettingsAdapter(code, () => client);
    const localFixture = createLocalFunctions();
    localFixtures.push(localFixture);
    mock.property(selection.codeContext.mock.workspace, 'isTrusted', isTrusted);
    mock.property(localFixture.m.workspace, 'isTrusted', isTrusted);
    const local = localFixture.target;
    return { ...selection, fn, app, client, code, settings, local, key: AzureNodeId.from(fn).toString(), appKey: AzureNodeId.from(app).toString() };
}

function copyCommand(s: ReturnType<typeof setup>): CopyFunctionUrl {
    return new CopyFunctionUrl(s.code, s.selector, new FunctionUrlResolver(s.code, () => s.client, s.local), s.local);
}

describe('Remote function commands (unit)', () => {
    afterEach(() => {
        localFixtures.forEach(fixture => { fixture.dispose(); });
        localFixtures = [];
        mock.restoreAll();
    });

    it('copies an anonymous URL without reading keys or retaining a stale code parameter', async () => {
        const s = setup('anonymous');
        const write = s.codeContext.mock.env.clipboard.writeText;
        await copyCommand(s).execute(s.key);
        expect(write.mock.calls[0].arguments[0]).to.equal('https://my-functions.azurewebsites.net/api/HttpTrigger?custom=value');
        expect(s.client.webApps.listFunctionKeys.mock.callCount()).to.equal(0);
        expect(s.client.webApps.listHostKeys.mock.callCount()).to.equal(0);
    });

    it('allows remote invocation, URL copying, and state updates in an untrusted workspace', async () => {
        const s = setup('anonymous', false);
        const host = createMockFunctionsHostClient();
        const write = s.codeContext.mock.env.clipboard.writeText;
        const prompts = respondToPrompts(s.codeContext.mock, [{ input: 'remote input' }]);
        await new ExecuteFunction(s.ctx, s.selector, () => s.client, () => host, s.local).execute(s.key);
        await copyCommand(s).execute(s.key);
        const state = new SetFunctionState(s.code, s.selector, s.settings, s.cache, s.local);
        await state.execute(false, s.key);
        expect(s.client.settings[`AzureWebJobs.${s.fn.functionName}.Disabled`]).to.equal('false');
        await state.execute(true, s.key);
        expect(s.client.settings[`AzureWebJobs.${s.fn.functionName}.Disabled`]).to.equal('true');
        expect(host.invoke.mock.calls[0].arguments).to.deep.equal([s.fn.functionName, 'remote input']);
        expect(write.mock.calls[0].arguments[0]).to.equal('https://my-functions.azurewebsites.net/api/HttpTrigger?custom=value');
        prompts.assertAllConsumed();
    });

    it('uses the default function key and URL-encodes it without exposing it in notifications', async () => {
        const s = setup();
        const write = s.codeContext.mock.env.clipboard.writeText;
        s.client.webApps.listFunctionKeys.mock.mockImplementation(() => Promise.resolve({ properties: { default: 'key+/?=', other: 'other' } }));
        await copyCommand(s).execute(s.key);
        expect(new URL(write.mock.calls[0].arguments[0]).searchParams.get('code')).to.equal('key+/?=');
        expect(s.client.webApps.listHostKeys.mock.callCount()).to.equal(0);
        expect(JSON.stringify(s.codeContext.mock.window.showInformationMessage.mock.calls)).to.not.include('key+/?=');
    });

    it('uses a host function key when there are no function-scoped keys', async () => {
        const s = setup();
        const write = s.codeContext.mock.env.clipboard.writeText;
        s.client.webApps.listHostKeys.mock.mockImplementation(() => Promise.resolve({
            masterKey: 'master', functionKeys: { default: 'host-function-key' },
        }));
        await copyCommand(s).execute(s.key);
        expect(new URL(write.mock.calls[0].arguments[0]).searchParams.get('code')).to.equal('host-function-key');
    });

    it('reports missing function keys without substituting the master key or changing the clipboard', async () => {
        const s = setup();
        const write = s.codeContext.mock.env.clipboard.writeText;
        await expect(copyCommand(s).execute(s.key)).to.be.rejectedWith(/No key/);
        expect(write.mock.callCount()).to.equal(0);
    });

    it('requires confirmation before reading or copying an admin key', async () => {
        const s = setup('admin');
        const write = s.codeContext.mock.env.clipboard.writeText;
        const command = copyCommand(s);
        await expect(command.execute(s.key)).to.be.rejectedWith(CancellationError);
        expect(s.client.webApps.listHostKeys.mock.callCount()).to.equal(0);
        expect(write.mock.callCount()).to.equal(0);
        respondToPrompts(s.codeContext.mock, [{ button: 'Copy' }]);
        await command.execute(s.key);
        expect(new URL(write.mock.calls[0].arguments[0]).searchParams.get('code')).to.equal('mock-master-key');
    });

    it('uses current access metadata when the cached function access level differs', async () => {
        const s = setup('anonymous');
        s.client.webApps.getFunction.mock.mockImplementation(() => Promise.resolve(makeFunctionEnvelope({
            invokeUrlTemplate: 'https://my-functions.azurewebsites.net/api/HttpTrigger',
            config: { bindings: [{ type: 'httpTrigger', authLevel: 'ADMIN' }] },
        })));
        await expect(copyCommand(s).execute(s.key)).to.be.rejectedWith(CancellationError);
        expect(s.client.webApps.listHostKeys.mock.callCount()).to.equal(0);
    });

    for (const url of ['http://my-functions.azurewebsites.net/api/fn', 'https://user:secret@my-functions.azurewebsites.net/api/fn', 'invalid']) {
        it(`rejects an unsafe or invalid invocation URL: ${url.split(':')[0]}`, async () => {
            const s = setup('anonymous');
            const write = s.codeContext.mock.env.clipboard.writeText;
            s.client.webApps.getFunction.mock.mockImplementation(() => Promise.resolve(makeFunctionEnvelope({ invokeUrlTemplate: url })));
            await expect(copyCommand(s).execute(s.key)).to.be.rejected;
            expect(write.mock.callCount()).to.equal(0);
            expect(s.client.webApps.listFunctionKeys.mock.callCount()).to.equal(0);
        });
    }

    it('rejects an invocation URL whose host the selected app does not report before reading keys', async () => {
        const s = setup('function');
        const write = s.codeContext.mock.env.clipboard.writeText;
        s.client.webApps.getFunction.mock.mockImplementation(() => Promise.resolve(makeFunctionEnvelope({
            invokeUrlTemplate: 'https://attacker.example/api/HttpTrigger',
            config: { bindings: [{ type: 'httpTrigger', authLevel: 'function' }] },
        })));
        await expect(copyCommand(s).execute(s.key)).to.be.rejectedWith(/host name reported/);
        expect(write.mock.callCount()).to.equal(0);
        expect(s.client.webApps.listFunctionKeys.mock.callCount()).to.equal(0);
    });

    it('uses the management-plane trigger URL when no URL template is reported', async () => {
        const s = setup('anonymous');
        const write = s.codeContext.mock.env.clipboard.writeText;
        s.client.webApps.getFunction.mock.mockImplementation(() => Promise.resolve(makeFunctionEnvelope({
            config: { bindings: [{ type: 'httpTrigger', authLevel: 'anonymous' }] },
        })));
        s.client.webApps.listFunctionSecrets.mock.mockImplementation(() => Promise.resolve({ triggerUrl: 'https://my-functions.azurewebsites.net/custom' }));
        await copyCommand(s).execute(s.key);
        expect(write.mock.calls[0].arguments[0]).to.equal('https://my-functions.azurewebsites.net/custom');
    });

    for (const disabled of [true, false]) {
        it(`writes the function disable flag as ${String(disabled)} and preserves unrelated settings`, async () => {
            const s = setup();
            const invalidate = mock.method(s.cache, 'invalidate');
            await new SetFunctionState(s.code, s.selector, s.settings, s.cache, s.local).execute(disabled, s.key);
            expect(s.client.settings).to.deep.equal({
                Existing: 'preserved', [`AzureWebJobs.${s.fn.functionName}.Disabled`]: String(disabled),
            });
            expect(invalidate.mock.calls[0].arguments[0]).to.equal(s.app);
        });

        it(`updates a differently cased disable setting to ${String(disabled)} without duplicating it`, async () => {
            const s = setup();
            const existingName = `azurewebjobs.${s.fn.functionName.toUpperCase()}.DISABLED`;
            Reflect.deleteProperty(s.client.settings, `AzureWebJobs.${s.fn.functionName}.Disabled`);
            s.client.settings[existingName] = String(!disabled);

            await new SetFunctionState(s.code, s.selector, s.settings, s.cache, s.local).execute(disabled, s.key);

            expect(s.client.webApps.updateApplicationSettings.mock.calls[0].arguments[2].properties).to.deep.equal({
                Existing: 'preserved', [existingName]: String(disabled),
            });
        });
    }

    it('retains the tree and settings when a disable write fails', async () => {
        const s = setup();
        const invalidate = mock.method(s.cache, 'invalidate');
        s.client.webApps.updateApplicationSettings.mock.mockImplementation(() => Promise.reject(new Error('write rejected')));
        await expect(new SetFunctionState(s.code, s.selector, s.settings, s.cache, s.local).execute(false, s.key)).to.be.rejectedWith('write rejected');
        expect(invalidate.mock.callCount()).to.equal(0);
        expect(s.client.settings.Existing).to.equal('preserved');
        expect(s.client.settings[`AzureWebJobs.${s.fn.functionName}.Disabled`]).to.equal('true');
    });

    for (const failed of [false, true]) {
        it(`tracks a ${failed ? 'failed' : 'completed'} function deletion and evicts only after success`, async () => {
            const s = setup();
            const activities = new GenericActivityDataProvider();
            const remove = mock.method(s.cache, 'remove');
            respondToPrompts(s.codeContext.mock, [{ button: 'Delete' }]);
            if (failed) {
                s.client.webApps.deleteFunction.mock.mockImplementation(() => Promise.reject(new Error('delete rejected')));
            }
            const result = new DeleteFunction(s.code, s.selector, () => s.client, s.cache, activities).execute(s.key);
            if (failed) {
                await expect(result).to.be.rejectedWith('delete rejected');
            } else {
                await result;
            }
            expect(s.client.webApps.deleteFunction.mock.calls[0].arguments).to.deep.equal(['MyRG', s.app.name, s.fn.functionName]);
            expect(remove.mock.callCount()).to.equal(failed ? 0 : 1);
            if (!failed) {
                expect(remove.mock.calls[0].arguments[0]).to.equal(s.fn);
            }
            expect((await activities.getChildren())[0].status).to.equal(failed ? 'Failed' : 'Completed');
            activities.dispose();
        });
    }

    it('does not delete or create an activity when confirmation is dismissed', async () => {
        const s = setup();
        const activities = new GenericActivityDataProvider();
        await expect(new DeleteFunction(s.code, s.selector, () => s.client, s.cache, activities).execute(s.key)).to.be.rejectedWith(CancellationError);
        expect(s.client.webApps.deleteFunction.mock.callCount()).to.equal(0);
        expect(await activities.getChildren()).to.be.empty;
        activities.dispose();
    });

    it('submits exact input through the host client and does not persist the payload', async () => {
        const s = setup();
        const host = createMockFunctionsHostClient();
        const factory = mock.fn((_target: FunctionsHostTarget) => host);
        const command = new ExecuteFunction(s.ctx, s.selector, () => s.client, factory, s.local);
        const input = '{"payload":"private"}';
        const responses = respondToPrompts(s.codeContext.mock, [{ input }]);
        await command.execute(s.key);
        responses.assertAllConsumed();
        expect(host.invoke.mock.calls[0].arguments).to.deep.equal([s.fn.functionName, input]);
        expect(s.client.webApps.get.mock.calls[0].arguments.slice(0, 2)).to.deep.equal(['MyRG', s.app.name]);
        const states = [s.ctx.extensionContext.workspaceState, s.ctx.extensionContext.globalState];
        expect(JSON.stringify(states.flatMap(state => state.keys().map(key => state.get(key))))).to.not.include('private');
        const target = factory.mock.calls[0].arguments[0];
        expect(s.client.webApps.listHostKeys.mock.callCount()).to.equal(0);
        if (!('endpoint' in target)) {
            throw new Error('Expected a remote host target');
        }
        expect(target.endpoint).to.equal('https://my-functions.azurewebsites.net');
        expect(await target.getMasterKey()).to.equal('mock-master-key');
    });

    it('does not contact Azure when input is cancelled', async () => {
        const s = setup();
        const host = createMockFunctionsHostClient();
        const command = new ExecuteFunction(s.ctx, s.selector, () => s.client, () => host, s.local);
        const responses = respondToPrompts(s.codeContext.mock, ['cancel']);
        await expect(command.execute(s.key)).to.be.rejectedWith(CancellationError);
        responses.assertAllConsumed();
        expect(s.client.webApps.get.mock.callCount()).to.equal(0);
        expect(host.invoke.mock.callCount()).to.equal(0);
    });

    it('reveals an identity across resource groups with focus and selection', async () => {
        const s = setup();
        const id = `/subscriptions/${s.app.subscription.subscriptionId}/resourceGroups/IdentityRG/providers/Microsoft.ManagedIdentity/userAssignedIdentities/my-identity`;
        const reveal = mock.fn((_key: string, _options?: { select?: boolean; focus?: boolean }) => Promise.resolve());
        s.client.webApps.get.mock.mockImplementation(() => Promise.resolve({
            location: 'eastus', identity: { type: 'UserAssigned', userAssignedIdentities: { [id]: {} } },
        }));
        await new RevealFunctionAppIdentity(s.ctx, s.selector, () => s.client, new RevealResource({ reveal } as never)).execute(s.appKey);
        expect(reveal.mock.calls[0].arguments).to.deep.equal([
            AzureNodeId.from(s.app).forRelatedResource(id).toString(), { select: true, focus: true },
        ]);
        expect(s.codeContext.mock.quickPicks).to.be.empty;
    });

    it('reports a missing user-assigned identity', async () => {
        const s = setup();
        const reveal = mock.fn(() => Promise.resolve());
        await expect(new RevealFunctionAppIdentity(s.ctx, s.selector, () => s.client, new RevealResource({ reveal } as never))
            .execute(s.appKey)).to.be.rejectedWith(/does not have a user-assigned identity/);
        expect(reveal.mock.callCount()).to.equal(0);
    });

    it('selects between multiple identities and explains a filtered reveal target', async () => {
        const s = setup();
        const prefix = `/subscriptions/${s.app.subscription.subscriptionId}/resourceGroups/IdentityRG/providers/Microsoft.ManagedIdentity/userAssignedIdentities/`;
        const first = `${prefix}first`;
        const second = `${prefix}second`;
        const reveal = mock.fn((_key: string) => Promise.reject(new Error('Target is filtered')));
        s.client.webApps.get.mock.mockImplementation(() => Promise.resolve({
            location: 'eastus', identity: { type: 'UserAssigned', userAssignedIdentities: { [first]: {}, [second]: {} } },
        }));
        const responses = respondToPrompts(s.codeContext.mock, [{ pick: 'second' }]);
        await expect(new RevealFunctionAppIdentity(s.ctx, s.selector, () => s.client, new RevealResource({ reveal } as never))
            .execute(s.appKey)).to.be.rejectedWith(/Could not reveal the identity.*subscription may not be shown/);
        responses.assertAllConsumed();
        expect(reveal.mock.calls[0].arguments[0]).to.equal(AzureNodeId.from(s.app).forRelatedResource(second).toString());
    });

    it('submits empty input without replacing it with a default payload', async () => {
        const s = setup();
        const host = createMockFunctionsHostClient();
        const responses = respondToPrompts(s.codeContext.mock, [{ input: '' }]);
        await new ExecuteFunction(s.ctx, s.selector, () => s.client, () => host, s.local).execute(s.key);
        responses.assertAllConsumed();
        expect(host.invoke.mock.calls[0].arguments).to.deep.equal([s.fn.functionName, '']);
    });

    it('delegates log ownership to the shared service', async () => {
        const s = setup();
        const streams = createFunctionLogs({ app: s.app }).service;
        const start = mock.method(streams, 'start', () => Promise.resolve());
        await new StreamFunctionLogs(s.selector, streams).execute(s.appKey);
        expect(start.mock.calls[0].arguments[0]).to.equal(s.app);
        streams.dispose();
    });

});
