/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppServiceLogicalType, FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { SettingsDataProvider } from '../../../../src/tree/resources/settings/SettingsDataProvider';
import { getSettingsNodes } from '../../../../src/tree/resources/settings/SettingsNode';
import { makeSettingsResource, StubAdapter } from '../../../settings/mockSettings';

describe('SettingsDataProvider (unit)', () => {
    const adapter = new StubAdapter({ logicalTypes: [FunctionAppLogicalType] });

    describe('canHandle', () => {
        it('claims settings nodes', () => {
            const provider = new SettingsDataProvider();
            const [node] = getSettingsNodes(makeSettingsResource(), adapter);

            expect(provider.canHandle(node)).to.be.true;
        });

        it('does not claim the owning resource, which stays with its own provider', () => {
            const provider = new SettingsDataProvider();

            expect(provider.canHandle(makeSettingsResource())).to.be.false;
        });

        it('rejects non-nodes', () => {
            const provider = new SettingsDataProvider();

            expect(provider.canHandle(undefined)).to.be.false;
            expect(provider.canHandle('not-a-node')).to.be.false;
        });
    });

    describe('getSettingsNodes', () => {
        it('returns one node carrying the product adapter', () => {
            const nodes = getSettingsNodes(makeSettingsResource(), adapter);

            expect(nodes).to.have.lengthOf(1);
            expect(nodes[0].azureResource.logicalType).to.equal(FunctionAppLogicalType);
            expect(nodes[0].adapter).to.equal(adapter);
        });

        it('returns nothing when the supplied adapter does not support the resource', () => {
            expect(getSettingsNodes(
                makeSettingsResource({ logicalType: AppServiceLogicalType }),
                adapter,
            )).to.be.empty;
        });
    });

    describe('getChildren', () => {
        it('reports settings as a leaf, since their contents are edited as a document', async () => {
            const provider = new SettingsDataProvider();

            expect(await provider.getChildren()).to.be.empty;
        });
    });
});
