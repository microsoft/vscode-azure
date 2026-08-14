/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, FunctionAppLogicalType, type ConcreteAzureNode, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { AzureSettingsDocumentSource } from '../../src/settings/AzureSettingsDocumentSource';
import { SettingsUri } from '../../src/settings/SettingsUri';
import { createCollectionNode } from '../../src/tree/resources/settings/SettingsNode';

const resource = makeGenericResource({
    id: '/subscriptions/test-sub/resourceGroups/rg/providers/Microsoft.Web/sites/app',
    name: 'app',
    type: 'Microsoft.Web/sites',
    logicalType: FunctionAppLogicalType,
    location: 'westus',
});

function createSource(options?: { populateTree?: boolean }) {
    const { vscode } = createMockVsCode();
    const node = createCollectionNode(resource, 'appSettings');

    const nodes = new Map<string, ConcreteAzureNode>();
    if (options?.populateTree ?? true) {
        nodes.set(AzureNodeId.from(node).toString(), node);
    }

    const read = mock.fn((_resource: GenericResource, _collectionId: string) => Promise.resolve({
        entries: [],
        resourceName: resource.name,
        collectionLabel: 'Application Settings',
        writable: true,
        structured: false,
    }));
    const write = mock.fn(() => Promise.resolve());
    const invalidate = mock.fn();

    const source = new AzureSettingsDocumentSource(
        vscode,
        { get: (key: string) => nodes.get(key), invalidate } as never,
        { read, write } as never,
    );

    return { source, uri: SettingsUri.from(vscode, node), node, read, write, invalidate };
}

describe('AzureSettingsDocumentSource (unit)', () => {
    it('resolves the URI to the resource the tree already loaded', async () => {
        const { source, uri, read } = createSource();

        await source.read(uri);

        expect(read.mock.callCount()).to.equal(1);
        const [resolved, collectionId] = read.mock.calls[0].arguments;
        expect(collectionId).to.equal('appSettings');
        // The very object the tree holds, not a copy rebuilt from the URI.
        expect(resolved).to.equal(resource);
    });

    it('invalidates the collection subtree after a write', async () => {
        const { source, uri, node, write, invalidate } = createSource();

        await source.write(uri, [{ key: 'A', value: '1' }]);

        expect(write.mock.callCount()).to.equal(1);
        expect(invalidate.mock.calls[0].arguments[0]).to.equal(node);
    });

    it('fails clearly when the node is no longer in the tree', async () => {
        const { source, uri, read } = createSource({ populateTree: false });

        await expect(source.read(uri)).to.be.rejectedWith(/no longer available/);
        expect(read.mock.callCount()).to.equal(0);
    });
});
