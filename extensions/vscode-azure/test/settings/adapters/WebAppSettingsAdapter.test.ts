/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AppServiceLogicalType, FunctionAppLogicalType, LogicAppLogicalType, type IWebAppClient,
} from '@microsoft/vscode-azure-azutils';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { WebAppSettingsAdapter } from '../../../src/settings/adapters/WebAppSettingsAdapter';
import { makeSettingsResource } from '../mockSettings';

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

            expect(adapter.canHandle(makeSettingsResource({ logicalType: FunctionAppLogicalType }))).to.be.true;
            expect(adapter.canHandle(makeSettingsResource({ logicalType: AppServiceLogicalType }))).to.be.true;
            expect(adapter.canHandle(makeSettingsResource({ logicalType: LogicAppLogicalType }))).to.be.true;
        });

        it('compares logical types case-insensitively', () => {
            const { adapter } = createAdapter();
            expect(adapter.canHandle(makeSettingsResource({ logicalType: FunctionAppLogicalType.toUpperCase() }))).to.be.true;
        });

        it('does not claim unrelated resource types', () => {
            const { adapter } = createAdapter();
            expect(adapter.canHandle(makeSettingsResource({ logicalType: 'Microsoft.Storage/storageAccounts' }))).to.be.false;
        });
    });

    describe('label', () => {
        it('names the settings for the tree and the document header', () => {
            const { adapter } = createAdapter();
            expect(adapter.label).to.equal('Application Settings');
        });
    });

    describe('read', () => {
        it('returns application settings sorted by key, for a stable display order', async () => {
            const { adapter } = createAdapter({ appSettings: { ZED: '1', alpha: '2', Beta: '3' } });

            const snapshot = await adapter.read(makeSettingsResource());

            expect(snapshot.entries.map(setting => setting.key)).to.deep.equal(['Beta', 'ZED', 'alpha']);
        });

        it('describes the snapshot honestly', async () => {
            const { adapter } = createAdapter({ appSettings: { A: '1' } });

            const snapshot = await adapter.read(makeSettingsResource());

            expect(snapshot.resourceName).to.equal('MyFuncApp');
            expect(snapshot.writable).to.be.true;
        });

        it('handles a resource with no settings at all', async () => {
            const { adapter } = createAdapter();

            const snapshot = await adapter.read(makeSettingsResource());

            expect(snapshot.entries).to.be.empty;
        });

        it('passes the resource group parsed from the ARM id', async () => {
            const { adapter, listApplicationSettings } = createAdapter();

            await adapter.read(makeSettingsResource());

            expect(listApplicationSettings.mock.calls[0].arguments).to.deep.equal(['MyRG', 'MyFuncApp']);
        });

        it('fails clearly when the ARM id has no resource group', async () => {
            const { adapter } = createAdapter();
            const resource = makeSettingsResource({ id: '/subscriptions/sub' });

            await expect(adapter.read(resource)).to.be.rejectedWith(/resource group/);
        });
    });

    describe('write', () => {
        it('sends the entries verbatim as the whole dictionary', async () => {
            const { adapter, updateApplicationSettings } = createAdapter();

            await adapter.write(makeSettingsResource(), [
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

            await adapter.write(makeSettingsResource(), []);

            expect(updateApplicationSettings.mock.calls[0].arguments[2]).to.deep.equal({ properties: {} });
            // Last-writer-wins: no read-before-write on the editor path.
            expect(listApplicationSettings.mock.callCount()).to.equal(0);
        });

        it('rejects an invalid setting name before calling ARM, even from an editor save', async () => {
            const { adapter, updateApplicationSettings } = createAdapter();

            await expect(
                adapter.write(makeSettingsResource(), [{ key: '  ', value: 'x' }]),
            ).to.be.rejectedWith(/cannot be empty/);

            expect(updateApplicationSettings.mock.callCount()).to.equal(0);
        });
    });
});
