/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { createMockWebAppClient } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { WebAppSettingsAdapter } from '../../../../src/settings/adapters/WebAppSettingsAdapter';
import { isSettingsNode } from '../../../../src/tree/resources/settings/SettingsNode';
import { WebAppDataProvider } from '../../../../src/tree/resources/webApp/WebAppDataProvider';
import { makeSettingsResource } from '../../../settings/mockSettings';

describe('WebAppDataProvider (unit)', () => {
    const adapter = new WebAppSettingsAdapter(
        createMockVsCode().vscode,
        () => createMockWebAppClient(),
    );
    const provider = new WebAppDataProvider(adapter);

    it('claims resources supported by its settings adapter', () => {
        expect(provider.canHandle(makeSettingsResource())).to.be.true;
        expect(provider.canHandle(makeSettingsResource({
            logicalType: 'Microsoft.Storage/storageAccounts',
        }))).to.be.false;
    });

    it('contributes a settings node carrying its adapter', () => {
        const [node] = provider.getChildren(makeSettingsResource());

        expect(isSettingsNode(node)).to.be.true;
        if (!isSettingsNode(node)) {
            throw new Error('Expected a settings node');
        }

        expect(node.azureResource.logicalType).to.equal(FunctionAppLogicalType);
        expect(node).to.have.property('adapter', adapter);
    });
});
