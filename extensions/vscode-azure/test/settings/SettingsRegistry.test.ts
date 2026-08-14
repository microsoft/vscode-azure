/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppServiceLogicalType, FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
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

    describe('validation', () => {
        it('throws when reading a resource with no adapter', async () => {
            const registry = createSettingsRegistry();

            await expect(registry.read(makeApp('Microsoft.Storage/storageAccounts'))).to.be.rejectedWith(/No settings adapter/);
        });

        it('throws when writing a resource with no adapter', async () => {
            const registry = createSettingsRegistry();

            await expect(registry.write(makeApp('Microsoft.Storage/storageAccounts'), [])).to.be.rejectedWith(/No settings adapter/);
        });
    });

    describe('write', () => {
        function setup(readOnly?: boolean) {
            const adapter = createStubAdapter({
                logicalTypes: [FunctionAppLogicalType],
                readOnly,
                entries: [entry('A', '1'), entry('B', '2')],
            });
            return { adapter, registry: createSettingsRegistry(adapter), resource: makeApp(FunctionAppLogicalType) };
        }

        it('replaces the settings wholesale, so an omitted key is deleted', async () => {
            const { adapter, registry, resource } = setup();

            await registry.write(resource, [entry('A', 'updated'), entry('C', '3')]);

            expect(adapter.contents()).to.deep.equal([entry('A', 'updated'), entry('C', '3')]);
        });

        it('surfaces the adapter\'s refusal without writing', async () => {
            const { adapter, registry, resource } = setup(true);

            await expect(registry.write(resource, [entry('A', '1')])).to.be.rejectedWith(/read-only/);

            expect(adapter.writes).to.be.empty;
        });
    });
});
