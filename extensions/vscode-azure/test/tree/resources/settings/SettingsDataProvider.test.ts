/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppServiceLogicalType, FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { createSettingsNode } from '../../../../src/tree/resources/settings/SettingsNode';
import { createSettingsDataProvider, createStubAdapter } from '../../../settings/mockSettings';

function makeApp(logicalType: string) {
    return makeGenericResource({
        id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/sites/app',
        name: 'app',
        type: 'Microsoft.Web/sites',
        logicalType,
    });
}

describe('SettingsDataProvider (unit)', () => {
    describe('canHandle', () => {
        it('claims settings nodes', () => {
            const provider = createSettingsDataProvider();

            expect(provider.canHandle(createSettingsNode(makeApp(FunctionAppLogicalType)))).to.be.true;
        });

        it('does not claim the owning resource, which stays with its own provider', () => {
            const provider = createSettingsDataProvider();

            expect(provider.canHandle(makeApp(FunctionAppLogicalType))).to.be.false;
        });

        it('rejects non-nodes', () => {
            const provider = createSettingsDataProvider();

            expect(provider.canHandle(undefined)).to.be.false;
            expect(provider.canHandle('not-a-node')).to.be.false;
        });
    });

    describe('getSettingsNodes', () => {
        it('returns one node for a resource whose product has an adapter', () => {
            const provider = createSettingsDataProvider(createStubAdapter({ logicalTypes: [FunctionAppLogicalType] }));

            const nodes = provider.getSettingsNodes(makeApp(FunctionAppLogicalType));

            expect(nodes).to.have.lengthOf(1);
            expect(nodes[0].azureResource.logicalType).to.equal(FunctionAppLogicalType);
        });

        it('returns nothing for a resource whose product has no adapter', () => {
            const provider = createSettingsDataProvider(createStubAdapter({ logicalTypes: [FunctionAppLogicalType] }));

            expect(provider.getSettingsNodes(makeApp(AppServiceLogicalType))).to.be.empty;
        });

        it('returns nothing when no adapters are registered at all', () => {
            const provider = createSettingsDataProvider();

            expect(provider.getSettingsNodes(makeApp(FunctionAppLogicalType))).to.be.empty;
        });
    });

    describe('getChildren', () => {
        it('reports settings as a leaf, since their contents are edited as a document', async () => {
            const provider = createSettingsDataProvider(createStubAdapter({
                logicalTypes: [FunctionAppLogicalType],
                entries: [{ key: 'A', value: '1' }],
            }));

            expect(await provider.getChildren()).to.be.empty;
        });
    });
});
