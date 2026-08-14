/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { createSettingsNode, isSettingsNode } from '../../../../src/tree/resources/settings/SettingsNode';

const resource = makeGenericResource({
    id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/sites/app',
    name: 'app',
    logicalType: FunctionAppLogicalType,
});

describe('SettingsNode (unit)', () => {
    describe('createSettingsNode', () => {
        it('hangs off the owning resource', () => {
            const node = createSettingsNode(resource);

            expect(node.azureResource).to.equal(resource);
        });

        it('gives the settings node a key distinct from its resource', () => {
            const node = AzureNodeId.from(createSettingsNode(resource)).toString();
            const owner = AzureNodeId.from(resource).toString();

            expect(node).to.not.equal(owner);
        });

        it('round-trips through AzureNodeId', () => {
            const key = AzureNodeId.from(createSettingsNode(resource)).toString();

            expect(AzureNodeId.parse(key).toString()).to.equal(key);
        });
    });

    describe('isSettingsNode', () => {
        it('claims a settings node', () => {
            expect(isSettingsNode(createSettingsNode(resource))).to.be.true;
        });

        it('rejects the owning resource and non-nodes', () => {
            expect(isSettingsNode(resource)).to.be.false;
            expect(isSettingsNode(undefined)).to.be.false;
            expect(isSettingsNode(null)).to.be.false;
            expect(isSettingsNode('not-a-node')).to.be.false;
        });

        it('rejects a virtual node owned by something else', () => {
            const foreign = { virtualType: 'acr.repositories', virtualPath: 'repos', azureResource: resource };

            expect(isSettingsNode(foreign)).to.be.false;
        });
    });
});
