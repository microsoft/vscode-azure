/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FunctionAppLogicalType, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import { AzureSettingsDocumentSource } from '../../src/settings/AzureSettingsDocumentSource';
import { SettingsUri } from '../../src/settings/SettingsUri';
import { createCollectionNode } from '../../src/tree/resources/settings/SettingsNode';

describe('AzureSettingsDocumentSource (unit)', () => {
    it('reconstructs resource context from the URI without reading the tree', async () => {
        const { vscode } = createMockVsCode();
        const resource = makeGenericResource({
            id: '/subscriptions/test-sub/resourceGroups/rg/providers/Microsoft.Web/sites/app',
            name: 'app',
            type: 'Microsoft.Web/sites',
            logicalType: FunctionAppLogicalType,
            location: 'westus',
        });
        const read = mock.fn((_resource: GenericResource, _collectionId: string) => Promise.resolve({
            entries: [],
            resourceName: resource.name,
            collectionLabel: 'Application Settings',
            writable: true,
            structured: false,
        }));
        const source = new AzureSettingsDocumentSource(
            vscode,
            { invalidate: mock.fn() } as never,
            { read, write: mock.fn() } as never,
        );
        const uri = SettingsUri.from(vscode, createCollectionNode(resource, 'appSettings'));

        await source.read(uri);

        expect(read.mock.callCount()).to.equal(1);
        const [resolved, collectionId] = read.mock.calls[0].arguments;
        expect(collectionId).to.equal('appSettings');
        expect(resolved).to.deep.include({
            id: resource.id,
            name: resource.name,
            type: resource.type,
            logicalType: resource.logicalType,
            location: resource.location,
        });
        expect(resolved.subscription).to.deep.include({
            accountId: resource.subscription.accountId,
            tenantId: resource.subscription.tenantId,
            subscriptionId: resource.subscription.subscriptionId,
            displayName: resource.subscription.displayName,
        });
    });
});
