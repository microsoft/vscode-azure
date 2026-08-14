/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import {
    collectionIdOf, createCollectionNode, isSettingsCollectionNode,
} from '../../../../src/tree/resources/settings/SettingsNode';

const resource = makeGenericResource({
    id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/sites/app',
    name: 'app',
    logicalType: FunctionAppLogicalType,
});

describe('SettingsNode (unit)', () => {
    describe('createCollectionNode', () => {
        it('carries the collection id as the virtual path', () => {
            const node = createCollectionNode(resource, 'appSettings');

            expect(collectionIdOf(node)).to.equal('appSettings');
            expect(node.azureResource).to.equal(resource);
        });

        it('gives two collections on one resource distinct node ids', () => {
            const first = AzureNodeId.from(createCollectionNode(resource, 'appSettings')).toString();
            const second = AzureNodeId.from(createCollectionNode(resource, 'other')).toString();

            expect(first).to.not.equal(second);
        });

        it('round-trips through AzureNodeId', () => {
            const node = createCollectionNode(resource, 'appSettings');
            const key = AzureNodeId.from(node).toString();

            expect(AzureNodeId.parse(key).toString()).to.equal(key);
        });
    });

    describe('isSettingsCollectionNode', () => {
        it('claims a collection node', () => {
            expect(isSettingsCollectionNode(createCollectionNode(resource, 'appSettings'))).to.be.true;
        });

        it('rejects the owning resource and non-nodes', () => {
            expect(isSettingsCollectionNode(resource)).to.be.false;
            expect(isSettingsCollectionNode(undefined)).to.be.false;
            expect(isSettingsCollectionNode(null)).to.be.false;
            expect(isSettingsCollectionNode('not-a-node')).to.be.false;
        });

        it('rejects a virtual node owned by something else', () => {
            const foreign = { virtualType: 'acr.repositories', virtualPath: 'repos', azureResource: resource };

            expect(isSettingsCollectionNode(foreign)).to.be.false;
        });
    });
});
