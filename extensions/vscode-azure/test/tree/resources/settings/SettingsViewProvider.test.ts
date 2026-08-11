/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, FunctionAppLogicalType, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { AddOrEditSetting } from '../../../../src/commands/settings/AddOrEditSetting';
import { CopySettingValue } from '../../../../src/commands/settings/CopySettingValue';
import { DeleteSetting } from '../../../../src/commands/settings/DeleteSetting';
import { EditSettings } from '../../../../src/commands/settings/EditSettings';
import { RenameSetting } from '../../../../src/commands/settings/RenameSetting';
import { SettingsViewProvider } from '../../../../src/tree/resources/settings/SettingsViewProvider';
import {
    createCollectionNode, createEntryNode,
} from '../../../../src/tree/resources/settings/SettingsNode';
import { createSettingsRegistry, createStubAdapter, entry } from '../../../settings/mockSettings';

const resource = makeGenericResource({
    id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/sites/app',
    name: 'app',
    logicalType: FunctionAppLogicalType,
});

function createProvider(options?: { showValues?: boolean }) {
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

    const adapter = createStubAdapter({ logicalTypes: [FunctionAppLogicalType] });

    const provider = new SettingsViewProvider(
        mockCtx.ctx,
        executor,
        tree as never,
        createSettingsRegistry(adapter),
        { showValues: options?.showValues ?? false, toggle: () => Promise.resolve(true) } as never,
    );

    return { provider, register };
}

describe('SettingsViewProvider (unit)', () => {
    describe('collection node', () => {
        it('labels the node with the collection label from the adapter', () => {
            const { provider, register } = createProvider();
            const key = register(createCollectionNode(resource, 'appSettings'));

            expect(provider.getTreeItem(key).label).to.equal('Application Settings');
        });

        it('is collapsible', () => {
            const { provider, register } = createProvider();
            const key = register(createCollectionNode(resource, 'appSettings'));

            expect(provider.getTreeItem(key).collapsibleState).to.equal(1);
        });

        it('offers edit, toggle, and add', () => {
            const { provider, register } = createProvider();
            const key = register(createCollectionNode(resource, 'appSettings'));

            const contextValue = provider.getTreeItem(key).contextValue ?? '';
            expect(contextValue).to.contain(EditSettings.ContextValue);
            expect(contextValue).to.contain(AddOrEditSetting.AddContextValue);
        });
    });

    describe('entry node', () => {
        it('labels the node with the setting key', () => {
            const { provider, register } = createProvider();
            const key = register(createEntryNode(resource, 'appSettings', entry('MY_SETTING', 'secret')));

            expect(provider.getTreeItem(key).label).to.equal('MY_SETTING');
        });

        it('is a leaf', () => {
            const { provider, register } = createProvider();
            const key = register(createEntryNode(resource, 'appSettings', entry('A', '1')));

            expect(provider.getTreeItem(key).collapsibleState).to.equal(0);
        });

        it('masks the value by default', () => {
            const { provider, register } = createProvider();
            const key = register(createEntryNode(resource, 'appSettings', entry('A', 'super-secret')));

            const description = provider.getTreeItem(key).description;
            expect(description).to.not.contain('super-secret');
            expect(description).to.be.a('string').and.not.be.empty;
        });

        it('shows the value once revealing is enabled', () => {
            const { provider, register } = createProvider({ showValues: true });
            const key = register(createEntryNode(resource, 'appSettings', entry('A', 'super-secret')));

            expect(provider.getTreeItem(key).description).to.equal('super-secret');
        });

        it('offers the full per-setting command set', () => {
            const { provider, register } = createProvider();
            const key = register(createEntryNode(resource, 'appSettings', entry('A', '1')));

            const contextValue = provider.getTreeItem(key).contextValue ?? '';
            expect(contextValue).to.contain(CopySettingValue.ContextValue);
            expect(contextValue).to.contain(AddOrEditSetting.EditContextValue);
            expect(contextValue).to.contain(RenameSetting.ContextValue);
            expect(contextValue).to.contain(DeleteSetting.ContextValue);
        });
    });

    describe('getParent', () => {
        it('reports an entry\'s parent as its collection, not the owning resource', () => {
            const { provider, register } = createProvider();
            const collectionKey = register(createCollectionNode(resource, 'appSettings'));
            const entryKey = register(createEntryNode(resource, 'appSettings', entry('A', '1')));

            expect(provider.getParent(entryKey)).to.equal(collectionKey);
        });
    });

    describe('canHandle', () => {
        it('claims settings nodes and nothing else', () => {
            const { provider, register } = createProvider();
            const settingsKey = register(createCollectionNode(resource, 'appSettings'));
            const resourceKey = register(resource);

            expect(provider.canHandle(settingsKey)).to.be.true;
            expect(provider.canHandle(resourceKey)).to.be.false;
            expect(provider.canHandle('not-a-node-id')).to.be.false;
        });
    });
});
