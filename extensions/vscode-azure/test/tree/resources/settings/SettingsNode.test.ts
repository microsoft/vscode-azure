/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource, makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { SettingsUri } from '../../../../src/settings/SettingsUri';
import { getSettingsNodes, isSettingsNode } from '../../../../src/tree/resources/settings/SettingsNode';
import { StubAdapter } from '../../../settings/mockSettings';

const resource = makeGenericResource({
    id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/sites/app',
    name: 'app',
    logicalType: FunctionAppLogicalType,
});
const adapter = new StubAdapter({ logicalTypes: [FunctionAppLogicalType] });
const [settingsNode] = getSettingsNodes(resource, adapter);

describe('SettingsNode (unit)', () => {
    describe('getSettingsNodes', () => {
        it('hangs off the owning resource', () => {
            expect(settingsNode.azureResource).to.equal(resource);
        });

        it('gives the settings node a key distinct from its resource', () => {
            const node = AzureNodeId.from(settingsNode).toString();
            const owner = AzureNodeId.from(resource).toString();

            expect(node).to.not.equal(owner);
        });

        it('round-trips through AzureNodeId', () => {
            const key = AzureNodeId.from(settingsNode).toString();

            expect(AzureNodeId.parse(key).toString()).to.equal(key);
        });

        it('names the document after the resource when the resource owns the settings', () => {
            expect(settingsNode.owner).to.equal(resource);
            expect(settingsNode.documentName).to.equal(resource.name);
        });
    });

    describe('getSettingsNodes with a virtual owner', () => {
        const production = makeVirtualResource({
            virtualType: 'environment',
            virtualPath: 'environments/production',
            azureResource: resource,
        });
        const preview = makeVirtualResource({
            virtualType: 'environment',
            virtualPath: 'environments/pr-42',
            azureResource: resource,
        });

        it('hands the adapter the virtual owner rather than the ARM resource', () => {
            const [node] = getSettingsNodes(production, adapter);

            expect(node.owner).to.equal(production);
            expect(node.azureResource).to.equal(resource);
        });

        it('keys the node beneath its owner, so siblings on one resource stay distinct', () => {
            const [first] = getSettingsNodes(production, adapter);
            const [second] = getSettingsNodes(preview, adapter);

            expect(first.virtualPath.startsWith(`${production.virtualPath}/`)).to.equal(true, first.virtualPath);
            expect(AzureNodeId.from(first).toString()).to.not.equal(AzureNodeId.from(second).toString());
        });

        it('gives each sibling its own document when a document name is supplied', () => {
            const code = createMockVsCode().vscode;
            const first = SettingsUri.from(code, getSettingsNodes(production, adapter, 'app (production)')[0]);
            const second = SettingsUri.from(code, getSettingsNodes(preview, adapter, 'app (pr-42)')[0]);

            expect(first.path.endsWith('/app (production).settings.jsonc')).to.equal(true, first.path);
            expect(second.path.endsWith('/app (pr-42).settings.jsonc')).to.equal(true, second.path);
        });

        it('is still a settings node', () => {
            expect(isSettingsNode(getSettingsNodes(production, adapter)[0])).to.be.true;
        });
    });

    describe('isSettingsNode', () => {
        it('claims a settings node', () => {
            expect(isSettingsNode(settingsNode)).to.be.true;
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

        it('rejects a node missing the parts the editor reads', () => {
            // Both are dereferenced past this guard -- the owner on every read and write, the
            // document name when titling the tab -- so a node without them is not one.
            expect(isSettingsNode({ ...settingsNode, owner: undefined })).to.be.false;
            expect(isSettingsNode({ ...settingsNode, documentName: undefined })).to.be.false;
        });
    });
});
