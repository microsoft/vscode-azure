/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppServiceLogicalType, FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import * as assert from 'node:assert';
import { expect } from 'chai';
import { createSettingsRegistry, createStubAdapter, entry } from './mockSettings';

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
        function setup(readOnlyCollections?: readonly string[]) {
            const adapter = createStubAdapter({
                logicalTypes: [FunctionAppLogicalType],
                readOnlyCollections,
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

        describe('adapter enforcement', () => {
            it('surfaces the adapter\'s refusal on every write path', async () => {
                const { adapter, registry, resource } = setup(['appSettings']);

                await assert.rejects(registry.write(resource, 'appSettings', [entry('A', '1')]), /read-only/);
                await assert.rejects(registry.upsert(resource, 'appSettings', entry('C', '3')), /read-only/);
                await assert.rejects(registry.remove(resource, 'appSettings', 'A'), /read-only/);
                await assert.rejects(registry.rename(resource, 'appSettings', 'A', 'X'), /read-only/);

                expect(adapter.writes).to.be.empty;
            });
        });
    });
});
