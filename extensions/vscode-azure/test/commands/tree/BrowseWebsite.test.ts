/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import { createMockDataItemTree, makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import { BrowseWebsite } from '../../../src/commands/tree/BrowseWebsite';
import type { IResourceEndpointResolver } from '../../../src/endpoints/ResourceEndpointResolver';

describe('BrowseWebsite (unit)', () => {
    function createProvider(endpoint: string | undefined, canHandle: boolean = true) {
        const mockResult = createMockVsCode();
        const resource = makeGenericResource();
        const dataTree = createMockDataItemTree([resource]);
        const resolve = mock.fn(() => Promise.resolve(endpoint));
        const resolver: IResourceEndpointResolver = {
            canHandle: mock.fn(() => canHandle),
            resolve,
        };
        const provider = new BrowseWebsite(mockResult.vscode, dataTree, resolver);
        return { provider, key: AzureNodeId.from(resource).toString(), resolve };
    }

    it('should return the resolved endpoint', async () => {
        const { provider, key } = createProvider('https://example.com/');

        expect(await provider.getUrl(key)).to.equal('https://example.com/');
    });

    it('should report when the selected resource has no endpoint yet', async () => {
        const { provider, key } = createProvider(undefined);
        let thrown: unknown;

        try {
            await provider.getUrl(key);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).to.be.instanceOf(Error).with.property('message', 'The selected resource does not have a website endpoint yet.');
    });

    it('should report when direct invocation selects an unsupported resource type', async () => {
        const { provider, key, resolve } = createProvider(undefined, false);
        let thrown: unknown;

        try {
            await provider.getUrl(key);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).to.be.instanceOf(Error).with.property('message', 'The selected resource type does not support website browsing.');
        expect(resolve.mock.callCount()).to.equal(0);
    });

    it('should reject an invalid tree selection without invoking the resolver', async () => {
        const { provider, resolve } = createProvider('https://example.com/');
        let thrown: unknown;

        try {
            await provider.getUrl('missing');
        } catch (error) {
            thrown = error;
        }

        expect(thrown).to.be.instanceOf(Error).with.property('message', 'Select an Azure resource with a website endpoint.');
        expect(resolve.mock.callCount()).to.equal(0);
    });
});
