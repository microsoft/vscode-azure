/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppServiceLogicalType, FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import * as assert from 'node:assert';
import { expect } from 'chai';
import { createSettingsRegistry, createStubAdapter, entry, permissiveCapabilities } from './mockSettings';

function makeApp(logicalType: string) {
    return makeGenericResource({
        id: `/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/sites/app-${logicalType}`,
        name: 'app',
        type: 'Microsoft.Web/sites',
        logicalType,
    });
}

describe('SettingsRegistry (unit)', () => {
    describe('dispatch', () => {
        it('finds the adapter that claims the resource', () => {
            const adapter = createStubAdapter({ logicalTypes: [FunctionAppLogicalType] });
            const registry = createSettingsRegistry(adapter);

            expect(registry.getAdapter(makeApp(FunctionAppLogicalType))).to.equal(adapter);
        });

        it('returns undefined when no adapter claims the resource', () => {
            const registry = createSettingsRegistry(createStubAdapter({ logicalTypes: [FunctionAppLogicalType] }));

            expect(registry.getAdapter(makeApp('Microsoft.Storage/storageAccounts'))).to.be.undefined;
        });

        it('reports no settings for an unsupported resource', () => {
            const registry = createSettingsRegistry();

            expect(registry.hasSettings(makeApp('Microsoft.Storage/storageAccounts'))).to.be.false;
            expect(registry.getCollections(makeApp('Microsoft.Storage/storageAccounts'))).to.be.empty;
        });

        it('matches logical types case-insensitively', () => {
            const registry = createSettingsRegistry(createStubAdapter({ logicalTypes: [FunctionAppLogicalType.toUpperCase()] }));

            expect(registry.hasSettings(makeApp(FunctionAppLogicalType.toLowerCase()))).to.be.true;
        });

        it('picks the first adapter that claims the resource', () => {
            const first = createStubAdapter({ logicalTypes: [FunctionAppLogicalType] });
            const second = createStubAdapter({ logicalTypes: [FunctionAppLogicalType] });

            expect(createSettingsRegistry(first, second).getAdapter(makeApp(FunctionAppLogicalType))).to.equal(first);
        });

        it('serves several logical types from one adapter', () => {
            const adapter = createStubAdapter({ logicalTypes: [FunctionAppLogicalType, AppServiceLogicalType] });
            const registry = createSettingsRegistry(adapter);

            expect(registry.hasSettings(makeApp(FunctionAppLogicalType))).to.be.true;
            expect(registry.hasSettings(makeApp(AppServiceLogicalType))).to.be.true;
        });
    });

    describe('getCollection', () => {
        it('finds a collection by id', () => {
            const registry = createSettingsRegistry(createStubAdapter({
                logicalTypes: [FunctionAppLogicalType],
                collections: [
                    { id: 'appSettings', label: 'Application Settings', structured: false },
                    { id: 'connectionStrings', label: 'Connection Strings', structured: true },
                ],
            }));

            expect(registry.getCollection(makeApp(FunctionAppLogicalType), 'connectionStrings')?.structured).to.be.true;
        });

        it('returns undefined for an unknown collection id', () => {
            const registry = createSettingsRegistry(createStubAdapter({ logicalTypes: [FunctionAppLogicalType] }));

            expect(registry.getCollection(makeApp(FunctionAppLogicalType), 'nope')).to.be.undefined;
        });
    });

    describe('validation', () => {
        it('throws when reading a resource with no adapter', async () => {
            const registry = createSettingsRegistry();

            await assert.rejects(registry.read(makeApp('Microsoft.Storage/storageAccounts'), 'appSettings'), /No settings adapter/);
        });

        it('throws when reading an unknown collection', async () => {
            const registry = createSettingsRegistry(createStubAdapter({ logicalTypes: [FunctionAppLogicalType] }));

            await assert.rejects(registry.read(makeApp(FunctionAppLogicalType), 'nope'), /does not expose a settings collection/);
        });
    });

    describe('single-key mutations', () => {
        function setup(capabilities = permissiveCapabilities) {
            const adapter = createStubAdapter({
                logicalTypes: [FunctionAppLogicalType],
                capabilities: { appSettings: capabilities },
                entries: { appSettings: [entry('A', '1'), entry('B', '2')] },
            });
            return { adapter, registry: createSettingsRegistry(adapter), resource: makeApp(FunctionAppLogicalType) };
        }

        it('adds a new setting while preserving the others', async () => {
            const { adapter, registry, resource } = setup();

            await registry.upsert(resource, 'appSettings', entry('C', '3'));

            expect(adapter.contents('appSettings')).to.deep.equal([entry('A', '1'), entry('B', '2'), entry('C', '3')]);
        });

        it('replaces an existing value in place, keeping order', async () => {
            const { adapter, registry, resource } = setup();

            await registry.upsert(resource, 'appSettings', entry('A', 'updated'));

            expect(adapter.contents('appSettings')).to.deep.equal([entry('A', 'updated'), entry('B', '2')]);
        });

        it('deletes only the named setting', async () => {
            const { adapter, registry, resource } = setup();

            await registry.remove(resource, 'appSettings', 'A');

            expect(adapter.contents('appSettings')).to.deep.equal([entry('B', '2')]);
        });

        it('treats deleting a missing key as a no-op', async () => {
            const { adapter, registry, resource } = setup();

            await registry.remove(resource, 'appSettings', 'MISSING');

            expect(adapter.contents('appSettings')).to.deep.equal([entry('A', '1'), entry('B', '2')]);
        });

        it('renames while preserving value and position', async () => {
            const { adapter, registry, resource } = setup();

            await registry.rename(resource, 'appSettings', 'A', 'RENAMED');

            expect(adapter.contents('appSettings')).to.deep.equal([entry('RENAMED', '1'), entry('B', '2')]);
        });

        it('refuses to rename onto an existing key, which would destroy it', async () => {
            const { adapter, registry, resource } = setup();

            await assert.rejects(registry.rename(resource, 'appSettings', 'A', 'B'), /already exists/);
            expect(adapter.writes).to.be.empty;
        });

        it('refuses to rename a key that does not exist', async () => {
            const { registry, resource } = setup();

            await assert.rejects(registry.rename(resource, 'appSettings', 'MISSING', 'X'), /no setting named/i);
        });

        it('preserves structured metadata through a rename', async () => {
            const adapter = createStubAdapter({
                logicalTypes: [FunctionAppLogicalType],
                collections: [{ id: 'connectionStrings', label: 'Connection Strings', structured: true }],
                entries: { connectionStrings: [entry('DB', 'conn', { type: 'SQLAzure' })] },
            });
            const registry = createSettingsRegistry(adapter);

            await registry.rename(makeApp(FunctionAppLogicalType), 'connectionStrings', 'DB', 'DB2');

            expect(adapter.contents('connectionStrings')).to.deep.equal([entry('DB2', 'conn', { type: 'SQLAzure' })]);
        });

        describe('capability enforcement', () => {
            it('refuses to write a read-only collection', async () => {
                const { registry, resource } = setup({ ...permissiveCapabilities, canWrite: false });

                await assert.rejects(registry.upsert(resource, 'appSettings', entry('C', '3')), /read-only/);
            });

            it('refuses to add when adding is not permitted, but still allows editing', async () => {
                const { adapter, registry, resource } = setup({ ...permissiveCapabilities, canAdd: false });

                await assert.rejects(registry.upsert(resource, 'appSettings', entry('NEW', 'x')), /cannot be added/);

                await registry.upsert(resource, 'appSettings', entry('A', 'edited'));
                expect(adapter.contents('appSettings')[0]).to.deep.equal(entry('A', 'edited'));
            });

            it('refuses to delete when deletion is not permitted', async () => {
                const { registry, resource } = setup({ ...permissiveCapabilities, canDelete: false });

                await assert.rejects(registry.remove(resource, 'appSettings', 'A'), /cannot be deleted/);
            });

            it('refuses to rename when renaming is not permitted', async () => {
                const { registry, resource } = setup({ ...permissiveCapabilities, canRename: false });

                await assert.rejects(registry.rename(resource, 'appSettings', 'A', 'X'), /cannot be renamed/);
            });

            it('refuses every single-key edit when values cannot be read back', async () => {
                // Read-modify-write would replace every *other* secret in the collection with the
                // unreadable-value placeholder, since that is all a read returns.
                const { adapter, registry, resource } = setup({ ...permissiveCapabilities, valuesReadable: false });

                await assert.rejects(registry.upsert(resource, 'appSettings', entry('C', '3')), /cannot be changed one at a time/);
                await assert.rejects(registry.remove(resource, 'appSettings', 'A'), /cannot be changed one at a time/);
                await assert.rejects(registry.rename(resource, 'appSettings', 'A', 'X'), /cannot be changed one at a time/);

                expect(adapter.writes).to.be.empty;
            });
        });
    });
});
