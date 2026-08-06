/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AppServiceLogicalType, FunctionAppLogicalType, LogicAppLogicalType,
    type ConnStringValueTypePair, type IWebAppClient,
} from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode, expectRejection } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import {
    AppSettingsCollectionId, ConnectionStringsCollectionId, WebAppSettingsAdapter,
} from '../../../src/settings/adapters/WebAppSettingsAdapter';

function makeSite(logicalType: string) {
    return makeGenericResource({
        id: '/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.Web/sites/mysite',
        name: 'mysite',
        type: 'Microsoft.Web/sites',
        logicalType,
    });
}

function createAdapter(options?: {
    appSettings?: Record<string, string>;
    connectionStrings?: Record<string, ConnStringValueTypePair>;
}) {
    const listApplicationSettings = mock.fn((_rg: string, _name: string) => Promise.resolve({ properties: options?.appSettings ?? {} }));
    const updateApplicationSettings = mock.fn((_rg: string, _name: string, _settings: unknown) => Promise.resolve({ properties: {} }));
    const listConnectionStrings = mock.fn((_rg: string, _name: string) => Promise.resolve({ properties: options?.connectionStrings ?? {} }));
    const updateConnectionStrings = mock.fn((_rg: string, _name: string, _settings: unknown) => Promise.resolve({ properties: {} }));

    const client = {
        webApps: { listApplicationSettings, updateApplicationSettings, listConnectionStrings, updateConnectionStrings },
    } as unknown as IWebAppClient;

    const adapter = new WebAppSettingsAdapter(createMockVsCode().vscode, () => client);

    return { adapter, listApplicationSettings, updateApplicationSettings, listConnectionStrings, updateConnectionStrings };
}

describe('WebAppSettingsAdapter (unit)', () => {
    describe('canHandle', () => {
        it('claims all three Microsoft.Web/sites flavours', () => {
            const { adapter } = createAdapter();

            expect(adapter.canHandle(makeSite(FunctionAppLogicalType))).to.be.true;
            expect(adapter.canHandle(makeSite(AppServiceLogicalType))).to.be.true;
            expect(adapter.canHandle(makeSite(LogicAppLogicalType))).to.be.true;
        });

        it('compares logical types case-insensitively', () => {
            const { adapter } = createAdapter();
            expect(adapter.canHandle(makeSite(FunctionAppLogicalType.toUpperCase()))).to.be.true;
        });

        it('does not claim unrelated resource types', () => {
            const { adapter } = createAdapter();
            expect(adapter.canHandle(makeSite('Microsoft.Storage/storageAccounts'))).to.be.false;
        });
    });

    describe('getCollections', () => {
        it('exposes application settings and connection strings', () => {
            const { adapter } = createAdapter();

            expect(adapter.getCollections(makeSite(FunctionAppLogicalType)).map(c => c.id))
                .to.deep.equal([AppSettingsCollectionId, ConnectionStringsCollectionId]);
        });

        it('marks only connection strings as structured', () => {
            const { adapter } = createAdapter();
            const collections = adapter.getCollections(makeSite(AppServiceLogicalType));

            expect(collections.find(c => c.id === AppSettingsCollectionId)?.structured).to.be.false;
            expect(collections.find(c => c.id === ConnectionStringsCollectionId)?.structured).to.be.true;
        });

        it('exposes nothing for an unsupported resource', () => {
            const { adapter } = createAdapter();
            expect(adapter.getCollections(makeSite('Microsoft.Storage/storageAccounts'))).to.be.empty;
        });
    });

    describe('getCapabilities', () => {
        it('permits full editing of application settings', () => {
            const { adapter } = createAdapter();
            const capabilities = adapter.getCapabilities(makeSite(FunctionAppLogicalType), AppSettingsCollectionId);

            expect(capabilities.canAdd).to.be.true;
            expect(capabilities.canDelete).to.be.true;
            expect(capabilities.canRename).to.be.true;
            expect(capabilities.canWrite).to.be.true;
            expect(capabilities.valuesReadable).to.be.true;
        });

        it('rejects an empty setting name', () => {
            const { adapter } = createAdapter();
            const { validateKey } = adapter.getCapabilities(makeSite(FunctionAppLogicalType), AppSettingsCollectionId);

            expect(validateKey?.('  ')).to.be.a('string');
            expect(validateKey?.('OK')).to.be.undefined;
        });

        it('validates connection string types against the ARM-accepted set', () => {
            const { adapter } = createAdapter();
            const { validateMetadata } = adapter.getCapabilities(makeSite(FunctionAppLogicalType), ConnectionStringsCollectionId);

            expect(validateMetadata?.('type', 'SQLAzure')).to.be.undefined;
            expect(validateMetadata?.('type', 'NotAType')).to.be.a('string');
            expect(validateMetadata?.('unknownField', 'x')).to.be.a('string');
        });

        it('throws for a collection it does not expose', () => {
            const { adapter } = createAdapter();
            expect(() => adapter.getCapabilities(makeSite(FunctionAppLogicalType), 'nope')).to.throw();
        });
    });

    describe('read', () => {
        it('returns application settings sorted by key, for a stable display order', async () => {
            const { adapter } = createAdapter({ appSettings: { ZED: '1', ALPHA: '2', MIKE: '3' } });

            const snapshot = await adapter.read(makeSite(FunctionAppLogicalType), AppSettingsCollectionId);

            expect(snapshot.entries.map(e => e.key)).to.deep.equal(['ALPHA', 'MIKE', 'ZED']);
        });

        it('describes the snapshot honestly', async () => {
            const { adapter } = createAdapter({ appSettings: { A: '1' } });

            const snapshot = await adapter.read(makeSite(FunctionAppLogicalType), AppSettingsCollectionId);

            expect(snapshot.resourceName).to.equal('mysite');
            expect(snapshot.writable).to.be.true;
            expect(snapshot.valuesReadable).to.be.true;
            expect(snapshot.structured).to.be.false;
        });

        it('handles a collection with no properties at all', async () => {
            const { adapter, listApplicationSettings } = createAdapter();
            listApplicationSettings.mock.mockImplementation(() => Promise.resolve({ properties: undefined as unknown as Record<string, string> }));
            const snapshot = await adapter.read(makeSite(FunctionAppLogicalType), AppSettingsCollectionId);

            expect(snapshot.entries).to.be.empty;
        });

        it('splits connection strings into value plus type metadata', async () => {
            const { adapter } = createAdapter({
                connectionStrings: { MyDb: { value: 'conn', type: 'SQLAzure' } },
            });

            const snapshot = await adapter.read(makeSite(AppServiceLogicalType), ConnectionStringsCollectionId);

            expect(snapshot.structured).to.be.true;
            expect(snapshot.entries).to.deep.equal([{ key: 'MyDb', value: 'conn', metadata: { type: 'SQLAzure' } }]);
        });

        it('passes the resource group parsed from the ARM id', async () => {
            const { adapter, listApplicationSettings } = createAdapter();

            await adapter.read(makeSite(FunctionAppLogicalType), AppSettingsCollectionId);

            expect(listApplicationSettings.mock.calls[0].arguments).to.deep.equal(['rg1', 'mysite']);
        });

        it('fails clearly when the ARM id has no resource group', async () => {
            const { adapter } = createAdapter();
            const resource = makeGenericResource({
                id: '/subscriptions/sub/providers/Microsoft.Web/sites/mysite',
                name: 'mysite',
                logicalType: FunctionAppLogicalType,
            });

            await expectRejection(adapter.read(resource, AppSettingsCollectionId), /resource group/);
        });
    });

    describe('write', () => {
        it('sends the entries verbatim as the whole dictionary', async () => {
            const { adapter, updateApplicationSettings } = createAdapter({ appSettings: { A: '1', B: '2' } });

            await adapter.write(makeSite(FunctionAppLogicalType), AppSettingsCollectionId, [{ key: 'A', value: 'new' }]);

            // 'B' is absent, which is how a delete is expressed.
            expect(updateApplicationSettings.mock.calls[0].arguments[2]).to.deep.equal({ properties: { A: 'new' } });
        });

        it('does not merge with the remote state', async () => {
            const { adapter, updateApplicationSettings, listApplicationSettings } = createAdapter({
                appSettings: { KEEP: 'x', DROP: 'y' },
            });

            await adapter.write(makeSite(FunctionAppLogicalType), AppSettingsCollectionId, []);

            expect(updateApplicationSettings.mock.calls[0].arguments[2]).to.deep.equal({ properties: {} });
            // Last-writer-wins: no read-before-write on the editor path.
            expect(listApplicationSettings.mock.callCount()).to.equal(0);
        });

        it('reassembles connection strings from value plus metadata', async () => {
            const { adapter, updateConnectionStrings } = createAdapter();

            await adapter.write(makeSite(FunctionAppLogicalType), ConnectionStringsCollectionId, [
                { key: 'MyDb', value: 'conn', metadata: { type: 'PostgreSQL' } },
            ]);

            expect(updateConnectionStrings.mock.calls[0].arguments[2]).to.deep.equal({
                properties: { MyDb: { value: 'conn', type: 'PostgreSQL' } },
            });
        });

        it('defaults a connection string with no type to Custom', async () => {
            const { adapter, updateConnectionStrings } = createAdapter();

            await adapter.write(makeSite(FunctionAppLogicalType), ConnectionStringsCollectionId, [
                { key: 'MyDb', value: 'conn' },
            ]);

            expect(updateConnectionStrings.mock.calls[0].arguments[2]).to.deep.equal({
                properties: { MyDb: { value: 'conn', type: 'Custom' } },
            });
        });

        it('rejects an invalid connection string type before calling ARM', async () => {
            const { adapter, updateConnectionStrings } = createAdapter();

            await expectRejection(
                adapter.write(makeSite(FunctionAppLogicalType), ConnectionStringsCollectionId, [
                    { key: 'MyDb', value: 'conn', metadata: { type: 'Bogus' } },
                ]),
                /MyDb/,
            );

            expect(updateConnectionStrings.mock.callCount()).to.equal(0);
        });

        it('throws for a collection it does not expose', async () => {
            const { adapter } = createAdapter();

            await expectRejection(adapter.write(makeSite(FunctionAppLogicalType), 'nope', []), /nope/);
        });
    });
});
