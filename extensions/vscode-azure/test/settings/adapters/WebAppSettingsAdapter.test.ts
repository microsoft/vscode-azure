/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AppServiceLogicalType, FunctionAppLogicalType, LogicAppLogicalType, type IWebAppClient,
} from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import { AppSettingsCollectionId, WebAppSettingsAdapter } from '../../../src/settings/adapters/WebAppSettingsAdapter';

function makeSite(logicalType: string) {
    return makeGenericResource({
        id: '/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.Web/sites/mysite',
        name: 'mysite',
        type: 'Microsoft.Web/sites',
        logicalType,
    });
}

function createAdapter(options?: { appSettings?: Record<string, string> }) {
    const listApplicationSettings = mock.fn((_rg: string, _name: string) => Promise.resolve({ properties: options?.appSettings ?? {} }));
    const updateApplicationSettings = mock.fn((_rg: string, _name: string, _settings: unknown) => Promise.resolve({ properties: {} }));

    const client = {
        webApps: { listApplicationSettings, updateApplicationSettings },
    } as unknown as IWebAppClient;

    const adapter = new WebAppSettingsAdapter(createMockVsCode().vscode, () => client);

    return { adapter, listApplicationSettings, updateApplicationSettings };
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
        it('exposes application settings', () => {
            const { adapter } = createAdapter();
            const collections = adapter.getCollections(makeSite(FunctionAppLogicalType));

            expect(collections.map(collection => collection.id)).to.deep.equal([AppSettingsCollectionId]);
        });

        it('exposes nothing for an unsupported resource', () => {
            const { adapter } = createAdapter();
            expect(adapter.getCollections(makeSite('Microsoft.Storage/storageAccounts'))).to.be.empty;
        });
    });

    describe('read', () => {
        it('returns application settings sorted by key, for a stable display order', async () => {
            const { adapter } = createAdapter({ appSettings: { ZED: '1', alpha: '2', Beta: '3' } });

            const snapshot = await adapter.read(makeSite(FunctionAppLogicalType), AppSettingsCollectionId);

            expect(snapshot.entries.map(setting => setting.key)).to.deep.equal(['Beta', 'ZED', 'alpha']);
        });

        it('describes the snapshot honestly', async () => {
            const { adapter } = createAdapter({ appSettings: { A: '1' } });

            const snapshot = await adapter.read(makeSite(FunctionAppLogicalType), AppSettingsCollectionId);

            expect(snapshot.resourceName).to.equal('mysite');
            expect(snapshot.writable).to.be.true;
        });

        it('handles a collection with no properties at all', async () => {
            const { adapter } = createAdapter();

            const snapshot = await adapter.read(makeSite(FunctionAppLogicalType), AppSettingsCollectionId);

            expect(snapshot.entries).to.be.empty;
        });

        it('passes the resource group parsed from the ARM id', async () => {
            const { adapter, listApplicationSettings } = createAdapter();

            await adapter.read(makeSite(FunctionAppLogicalType), AppSettingsCollectionId);

            expect(listApplicationSettings.mock.calls[0].arguments).to.deep.equal(['rg1', 'mysite']);
        });

        it('fails clearly when the ARM id has no resource group', async () => {
            const { adapter } = createAdapter();
            const resource = makeGenericResource({
                id: '/subscriptions/sub',
                name: 'mysite',
                type: 'Microsoft.Web/sites',
                logicalType: FunctionAppLogicalType,
            });

            await expect(adapter.read(resource, AppSettingsCollectionId)).to.be.rejectedWith(/resource group/);
        });

        it('throws for a collection it does not expose', async () => {
            const { adapter } = createAdapter();

            await expect(adapter.read(makeSite(FunctionAppLogicalType), 'nope')).to.be.rejectedWith(/nope/);
        });
    });

    describe('write', () => {
        it('sends the entries verbatim as the whole dictionary', async () => {
            const { adapter, updateApplicationSettings } = createAdapter();

            await adapter.write(makeSite(FunctionAppLogicalType), AppSettingsCollectionId, [
                { key: 'A', value: '1' },
                { key: 'B', value: '2' },
            ]);

            expect(updateApplicationSettings.mock.calls[0].arguments[2]).to.deep.equal({
                properties: { A: '1', B: '2' },
            });
        });

        it('does not merge with the remote state', async () => {
            const { adapter, updateApplicationSettings, listApplicationSettings } = createAdapter({
                appSettings: { EXISTING: 'keep-me' },
            });

            await adapter.write(makeSite(FunctionAppLogicalType), AppSettingsCollectionId, []);

            expect(updateApplicationSettings.mock.calls[0].arguments[2]).to.deep.equal({ properties: {} });
            // Last-writer-wins: no read-before-write on the editor path.
            expect(listApplicationSettings.mock.callCount()).to.equal(0);
        });

        it('rejects an invalid setting name before calling ARM, even from an editor save', async () => {
            const { adapter, updateApplicationSettings } = createAdapter();

            await expect(
                adapter.write(makeSite(FunctionAppLogicalType), AppSettingsCollectionId, [{ key: '  ', value: 'x' }]),
            ).to.be.rejectedWith(/cannot be empty/);

            expect(updateApplicationSettings.mock.callCount()).to.equal(0);
        });

        it('throws for a collection it does not expose', async () => {
            const { adapter } = createAdapter();

            await expect(adapter.write(makeSite(FunctionAppLogicalType), 'nope', [])).to.be.rejectedWith(/nope/);
        });
    });
});
