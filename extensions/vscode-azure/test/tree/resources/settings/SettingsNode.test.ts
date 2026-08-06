/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { expect } from 'chai';
import {
    collectionIdOf, createCollectionNode, createEntryNode, isSettingsCollectionNode,
    isSettingsEntryNode, isSettingsNode, parentCollectionOf, settingKeyOf,
} from '../../../../src/tree/resources/settings/SettingsNode';

const resource = makeGenericResource({
    id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/sites/app',
    name: 'app',
    logicalType: FunctionAppLogicalType,
});

describe('SettingsNode (unit)', () => {
    describe('type guards', () => {
        it('recognizes collection nodes', () => {
            const node = createCollectionNode(resource, 'appSettings');

            expect(isSettingsNode(node)).to.be.true;
            expect(isSettingsCollectionNode(node)).to.be.true;
            expect(isSettingsEntryNode(node)).to.be.false;
        });

        it('recognizes entry nodes', () => {
            const node = createEntryNode(resource, 'appSettings', { key: 'A', value: '1' });

            expect(isSettingsNode(node)).to.be.true;
            expect(isSettingsEntryNode(node)).to.be.true;
            expect(isSettingsCollectionNode(node)).to.be.false;
        });

        it('rejects unrelated values', () => {
            expect(isSettingsNode(undefined)).to.be.false;
            expect(isSettingsNode(resource)).to.be.false;
            expect(isSettingsNode({ virtualType: 'something.else', virtualPath: 'x', azureResource: resource })).to.be.false;
        });
    });

    describe('entry identity', () => {
        it('carries the value so the view needs no extra fetch', () => {
            const node = createEntryNode(resource, 'appSettings', { key: 'A', value: 'secret' });
            expect(node.value).to.equal('secret');
        });

        it('carries structured metadata', () => {
            const node = createEntryNode(resource, 'connectionStrings', { key: 'DB', value: 'c', metadata: { type: 'SQLAzure' } });
            expect(node.metadata).to.deep.equal({ type: 'SQLAzure' });
        });

        it('reports its key and collection', () => {
            const node = createEntryNode(resource, 'appSettings', { key: 'MY_KEY', value: '1' });

            expect(settingKeyOf(node)).to.equal('MY_KEY');
            expect(collectionIdOf(node)).to.equal('appSettings');
        });

        it('gives the same key in two collections distinct node ids', () => {
            const appSetting = createEntryNode(resource, 'appSettings', { key: 'Database', value: '1' });
            const connectionString = createEntryNode(resource, 'connectionStrings', { key: 'Database', value: '2' });

            expect(AzureNodeId.from(appSetting).toString())
                .to.not.equal(AzureNodeId.from(connectionString).toString());
        });

        it('survives a node id round-trip', () => {
            const node = createEntryNode(resource, 'appSettings', { key: 'MY_KEY', value: '1' });
            const nodeId = AzureNodeId.from(node).toString();

            const parsed = AzureNodeId.parse(nodeId);
            expect(parsed.toString()).to.equal(nodeId);
        });

        it('handles a key containing a slash', () => {
            const node = createEntryNode(resource, 'appSettings', { key: 'a/b/c', value: '1' });

            expect(settingKeyOf(node)).to.equal('a/b/c');
            expect(collectionIdOf(node)).to.equal('appSettings');
        });

        it('handles a key containing a colon or spaces', () => {
            const node = createEntryNode(resource, 'appSettings', { key: 'My Key:Sub', value: '1' });
            expect(settingKeyOf(node)).to.equal('My Key:Sub');
        });

        it('refuses to report a setting key for a collection node', () => {
            expect(() => settingKeyOf(createCollectionNode(resource, 'appSettings') as never)).to.throw();
        });
    });

    describe('parentCollectionOf', () => {
        it('returns the owning collection node', () => {
            const entry = createEntryNode(resource, 'appSettings', { key: 'A', value: '1' });
            const parent = parentCollectionOf(entry);

            expect(AzureNodeId.from(parent).toString())
                .to.equal(AzureNodeId.from(createCollectionNode(resource, 'appSettings')).toString());
        });
    });
});
