/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, FunctionAppLogicalType, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { EditSettings } from '../../../../src/commands/settings/EditSettings';
import { createSettingsNode } from '../../../../src/tree/resources/settings/SettingsNode';
import { SettingsDataProvider } from '../../../../src/tree/resources/settings/SettingsDataProvider';
import { SettingsViewProvider } from '../../../../src/tree/resources/settings/SettingsViewProvider';
import { makeSettingsResource, StubAdapter } from '../../../settings/mockSettings';

const resource = makeSettingsResource({
    id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/sites/app',
    name: 'app',
});

function createProvider() {
    const mockCtx = createMockCodeContext();
    const { executor } = createTestActionExecutor();

    const nodes = new Map<string, ConcreteAzureNode>();
    const register = (node: ConcreteAzureNode) => {
        const key = AzureNodeId.from(node).toString();
        nodes.set(key, node);
        return key;
    };

    const tree = {
        get: (key: string) => nodes.get(key),
        getChildren: () => Promise.resolve([]),
    };

    const adapter = new StubAdapter({ logicalTypes: [FunctionAppLogicalType] });

    const provider = new SettingsViewProvider(
        mockCtx.ctx,
        executor,
        tree as never,
        new SettingsDataProvider([adapter]),
    );

    return { provider, register };
}

describe('SettingsViewProvider (unit)', () => {
    describe('collection node', () => {
        it('labels the node with the collection label from the adapter', () => {
            const { provider, register } = createProvider();
            const key = register(createSettingsNode(resource));

            expect(provider.getTreeItem(key).label).to.equal('Application Settings');
        });

        it('is a leaf, since the settings are edited as a document', () => {
            const { provider, register } = createProvider();
            const key = register(createSettingsNode(resource));

            expect(provider.getTreeItem(key).collapsibleState).to.equal(0);
        });

        it('offers the edit command as its context value', () => {
            const { provider, register } = createProvider();
            const key = register(createSettingsNode(resource));

            expect(provider.getTreeItem(key).contextValue ?? '').to.contain(EditSettings.ContextValue);
        });

        it('opens the editor on click', () => {
            const { provider, register } = createProvider();
            const key = register(createSettingsNode(resource));

            const command = provider.getTreeItem(key).command;
            expect(command?.command).to.equal(EditSettings.CommandId);
            expect(command?.arguments).to.deep.equal([key]);
        });

        it('shows no values, so nothing needs masking', () => {
            const { provider, register } = createProvider();
            const key = register(createSettingsNode(resource));

            expect(provider.getTreeItem(key).description).to.be.undefined;
        });
    });

    describe('canHandle', () => {
        it('claims settings nodes and nothing else', () => {
            const { provider, register } = createProvider();
            const settingsKey = register(createSettingsNode(resource));
            const resourceKey = register(resource);

            expect(provider.canHandle(settingsKey)).to.be.true;
            expect(provider.canHandle(resourceKey)).to.be.false;
            expect(provider.canHandle('not-a-node-id')).to.be.false;
        });
    });
});
