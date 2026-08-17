/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppServiceLogicalType, FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { SettingsDataProvider } from '../../../../src/tree/resources/settings/SettingsDataProvider';
import { createSettingsNode } from '../../../../src/tree/resources/settings/SettingsNode';
import { makeSettingsResource, StubAdapter } from '../../../settings/mockSettings';

describe('SettingsDataProvider (unit)', () => {
    describe('canHandle', () => {
        it('claims settings nodes', () => {
            const provider = new SettingsDataProvider([]);

            expect(provider.canHandle(createSettingsNode(makeSettingsResource()))).to.be.true;
        });

        it('does not claim the owning resource, which stays with its own provider', () => {
            const provider = new SettingsDataProvider([]);

            expect(provider.canHandle(makeSettingsResource())).to.be.false;
        });

        it('rejects non-nodes', () => {
            const provider = new SettingsDataProvider([]);

            expect(provider.canHandle(undefined)).to.be.false;
            expect(provider.canHandle('not-a-node')).to.be.false;
        });
    });

    describe('getAdapter', () => {
        it('finds the adapter that claims the resource', () => {
            const adapter = new StubAdapter({ logicalTypes: [FunctionAppLogicalType] });
            const provider = new SettingsDataProvider([adapter]);

            expect(provider.getAdapter(makeSettingsResource())).to.equal(adapter);
        });

        it('matches logical types case-insensitively', () => {
            const provider = new SettingsDataProvider([
                new StubAdapter({ logicalTypes: [FunctionAppLogicalType.toUpperCase()] }),
            ]);

            expect(provider.getAdapter(makeSettingsResource({ logicalType: FunctionAppLogicalType.toLowerCase() })))
                .to.not.equal(undefined);
        });

        it('picks the first adapter that claims the resource', () => {
            const first = new StubAdapter({ logicalTypes: [FunctionAppLogicalType] });
            const second = new StubAdapter({ logicalTypes: [FunctionAppLogicalType] });
            const provider = new SettingsDataProvider([first, second]);

            expect(provider.getAdapter(makeSettingsResource())).to.equal(first);
        });

        it('returns undefined when no adapter claims the resource', () => {
            const provider = new SettingsDataProvider([
                new StubAdapter({ logicalTypes: [FunctionAppLogicalType] }),
            ]);

            expect(provider.getAdapter(makeSettingsResource({ logicalType: AppServiceLogicalType }))).to.be.undefined;
        });
    });

    describe('getSettingsNodes', () => {
        it('returns one node for a resource whose product has an adapter', () => {
            const provider = new SettingsDataProvider([
                new StubAdapter({ logicalTypes: [FunctionAppLogicalType] }),
            ]);

            const nodes = provider.getSettingsNodes(makeSettingsResource());

            expect(nodes).to.have.lengthOf(1);
            expect(nodes[0].azureResource.logicalType).to.equal(FunctionAppLogicalType);
        });

        it('returns nothing for a resource whose product has no adapter', () => {
            const provider = new SettingsDataProvider([
                new StubAdapter({ logicalTypes: [FunctionAppLogicalType] }),
            ]);

            expect(provider.getSettingsNodes(makeSettingsResource({ logicalType: AppServiceLogicalType }))).to.be.empty;
        });

        it('returns nothing when no adapters are registered at all', () => {
            const provider = new SettingsDataProvider([]);

            expect(provider.getSettingsNodes(makeSettingsResource())).to.be.empty;
        });
    });

    describe('getChildren', () => {
        it('reports settings as a leaf, since their contents are edited as a document', async () => {
            const provider = new SettingsDataProvider([
                new StubAdapter({
                    logicalTypes: [FunctionAppLogicalType],
                    entries: [{ key: 'A', value: '1' }],
                }),
            ]);

            expect(await provider.getChildren()).to.be.empty;
        });
    });
});
