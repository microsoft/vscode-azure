/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { createMockDataItemTree, createMockViewItemTree, makeGenericResource, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, MockOutputChannel, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type { IAzureViewDataTree, IAzureViewViewItemTree } from '../../../src/services';
import { ResourceSelector } from '../../../src/tree/resources/ResourceSelector';

const subscription = makeSubscription();
const subId = AzureNodeId.from(subscription).toString();

const site1 = makeGenericResource({ name: 'site1', subscription });
const site1Id = AzureNodeId.from(site1).toString();

describe('ResourceSelector (unit)', () => {
    const output = new MockOutputChannel('test');

    it('should resolve a resource from the cache when a key is provided', async () => {
        const { ctx } = createMockCodeContext();
        const cache = createMockDataItemTree([site1]);
        const selector = new ResourceSelector(ctx, output, cache, undefined as unknown as IAzureViewViewItemTree);

        const result = await selector.select<GenericResource>('Microsoft.Web/sites', site1Id);

        expect(result.name).to.equal('site1');
        expect(result.logicalType).to.equal('Microsoft.Web/sites');
    });

    it('should not prompt the user when a key is provided', async () => {
        const { ctx, mock: mockResult } = createMockCodeContext();
        const cache = createMockDataItemTree([site1]);
        const selector = new ResourceSelector(ctx, output, cache, undefined as unknown as IAzureViewViewItemTree);

        await selector.select<GenericResource>('Microsoft.Web/sites', site1Id);

        expect(mockResult.quickPicks).to.have.length(0);
    });

    it('should throw when a key is provided but the resource is not in the cache', async () => {
        const { ctx } = createMockCodeContext();
        const cache = createMockDataItemTree([]);
        const selector = new ResourceSelector(ctx, output, cache, undefined as unknown as IAzureViewViewItemTree);

        await expect(selector.select<GenericResource>('Microsoft.Web/sites', 'missing-key'))
            .to.be.rejectedWith(/Resource not found/);
    });

    it('should prompt the user with a resource picker when no key is provided', async () => {
        const { ctx, mock: mockResult } = createMockCodeContext();
        const viewTree = createMockViewItemTree({
            '': [subId],
            [subId]: [site1Id],
        });
        const cache = createMockDataItemTree([subscription, site1]);
        const selector = new ResourceSelector(ctx, output, cache, viewTree as unknown as IAzureViewViewItemTree);

        respondToPrompts(mockResult, [
            { pick: 'test-sub $(chevron-right)' },
            { pick: 'site1' },
        ]);

        const result = await selector.select<GenericResource>('Microsoft.Web/sites');

        expect(result.name).to.equal('site1');
        expect(result.logicalType).to.equal('Microsoft.Web/sites');
    });

    it('should delegate whenEnriched to the data cache', async () => {
        const { ctx } = createMockCodeContext();
        const enriched = makeGenericResource({ name: 'enriched' });
        const whenEnriched = mock.fn((resource: GenericResource) => Promise.resolve(resource));
        const cache = { whenEnriched } as unknown as IAzureViewDataTree;
        const selector = new ResourceSelector(ctx, output, cache, undefined as unknown as IAzureViewViewItemTree);

        const result = await selector.whenEnriched<GenericResource>(enriched);

        expect(result).to.equal(enriched);
        expect(whenEnriched.mock.callCount()).to.equal(1);
        expect(whenEnriched.mock.calls[0].arguments[0]).to.equal(enriched);
    });
});
