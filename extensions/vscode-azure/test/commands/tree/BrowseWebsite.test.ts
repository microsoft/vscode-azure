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
    function createCommand(endpoint: string | undefined, canHandle: boolean = true) {
        const mockResult = createMockVsCode();
        const resource = makeGenericResource();
        const dataTree = createMockDataItemTree([resource]);
        const resolve = mock.fn(() => Promise.resolve(endpoint));
        const resolver: IResourceEndpointResolver = {
            canHandle: mock.fn(() => canHandle),
            resolve,
        };
        const command = new BrowseWebsite(mockResult.vscode, dataTree, resolver);
        return { command, key: AzureNodeId.from(resource).toString(), mockResult, resolve };
    }

    it('should open the resolved endpoint', async () => {
        const { command, key, mockResult } = createCommand('https://example.com/');

        await command.execute(key);

        expect(mockResult.env.openExternal.mock.callCount()).to.equal(1);
        expect(mockResult.env.openExternal.mock.calls[0].arguments[0].toString()).to.equal('https://example.com/');
    });

    it('should report when the selected resource has no endpoint yet', async () => {
        const { command, key, mockResult } = createCommand(undefined);
        let thrown: unknown;

        try {
            await command.execute(key);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).to.be.instanceOf(Error).with.property('message', 'The selected resource does not have a website endpoint yet.');
        expect(mockResult.env.openExternal.mock.callCount()).to.equal(0);
    });

    it('should report when direct invocation selects an unsupported resource type', async () => {
        const { command, key, resolve } = createCommand(undefined, false);
        let thrown: unknown;

        try {
            await command.execute(key);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).to.be.instanceOf(Error).with.property('message', 'The selected resource type does not support website browsing.');
        expect(resolve.mock.callCount()).to.equal(0);
    });

    it('should reject an invalid tree selection without invoking the resolver', async () => {
        const { command, resolve } = createCommand('https://example.com/');
        let thrown: unknown;

        try {
            await command.execute('missing');
        } catch (error) {
            thrown = error;
        }

        expect(thrown).to.be.instanceOf(Error).with.property('message', 'Select an Azure resource with a website endpoint.');
        expect(resolve.mock.callCount()).to.equal(0);
    });
});
