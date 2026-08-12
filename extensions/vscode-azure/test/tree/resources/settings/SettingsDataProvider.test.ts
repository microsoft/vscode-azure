/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppServiceLogicalType, FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { expect } from 'chai';
import { collectionIdOf, createCollectionNode } from '../../../../src/tree/resources/settings/SettingsNode';
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
        it('claims settings collection nodes', () => {
            const provider = createSettingsDataProvider();

            expect(provider.canHandle(createCollectionNode(makeApp(FunctionAppLogicalType), 'appSettings'))).to.be.true;
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

    describe('getCollectionNodes', () => {
        it('returns one node per collection the adapter exposes', () => {
            const provider = createSettingsDataProvider(createStubAdapter({
                logicalTypes: [FunctionAppLogicalType],
                collections: [
                    { id: 'appSettings', label: 'Application Settings' },
                    { id: 'other', label: 'Other Settings' },
                ],
            }));

            const nodes = provider.getCollectionNodes(makeApp(FunctionAppLogicalType));

            expect(nodes.map(collectionIdOf)).to.deep.equal(['appSettings', 'other']);
        });

        it('returns nothing for a resource whose product has no adapter', () => {
            const provider = createSettingsDataProvider(createStubAdapter({ logicalTypes: [FunctionAppLogicalType] }));

            expect(provider.getCollectionNodes(makeApp(AppServiceLogicalType))).to.be.empty;
        });

        it('returns nothing when no adapters are registered at all', () => {
            const provider = createSettingsDataProvider();

            expect(provider.getCollectionNodes(makeApp(FunctionAppLogicalType))).to.be.empty;
        });
    });

    describe('getChildren', () => {
        it('reports a collection as a leaf, since its contents are edited as a document', async () => {
            const provider = createSettingsDataProvider(createStubAdapter({
                logicalTypes: [FunctionAppLogicalType],
                entries: { appSettings: [{ key: 'A', value: '1' }] },
            }));

            expect(await provider.getChildren()).to.be.empty;
        });
    });
});
