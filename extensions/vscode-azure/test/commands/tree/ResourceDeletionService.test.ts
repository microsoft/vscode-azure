/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, isGenericResource, isResourceGroup, type ConcreteAzureNode, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { createMockDataItemTree, makeGenericResource, makeResourceGroup, makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { Container } from 'inversify';
import * as assert from 'node:assert';
import { mock, type Mock } from 'node:test';
import type { IAzdResourceAssociationService } from '../../../src/azd/AzdResourceAssociationService';
import { AzdDown } from '../../../src/commands/deploy/AzdDown';
import { ResourceDeletionResolver } from '../../../src/commands/tree/ResourceDeletionResolver';
import { ResourceDeletionService } from '../../../src/commands/tree/ResourceDeletionService';
import type { ResourceDeletionPlan, ResourceDeletionProvider } from '../../../src/registration/ResourceDeletionProvider';

describe('ResourceDeletionService (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('deletes a confirmed resource and removes it from the tree after success', async () => {
        const resource = makeGenericResource();
        const setup = createService(resource);
        setup.mockResult.messageResponses.push('Delete');

        await setup.service.delete(AzureNodeId.from(resource).toString(), 'resource');

        expect(setup.deleteOperation.mock.callCount()).to.equal(1);
        expect(setup.remove.mock.callCount()).to.equal(1);
        expect(setup.remove.mock.calls[0].arguments[0]).to.equal(resource);
    });

    it('does not remove the resource when the remote delete fails', async () => {
        const resource = makeGenericResource();
        const failure = new Error('delete failed');
        const setup = createService(resource, { deleteOperation: mock.fn(() => Promise.reject(failure)) });
        setup.mockResult.messageResponses.push('Delete');

        await assert.rejects(
            setup.service.delete(AzureNodeId.from(resource).toString(), 'resource'),
            failure,
        );

        expect(setup.remove.mock.callCount()).to.equal(0);
    });

    it('requires the resource group name before deletion', async () => {
        const resourceGroup = makeResourceGroup();
        const setup = createService(resourceGroup, {
            confirmation: {
                kind: 'typed',
                prompt: 'Type the resource group name.',
                expectedValue: resourceGroup.name,
            },
        });
        setup.mockResult.inputBoxResponses.push(resourceGroup.name);

        await setup.service.delete(AzureNodeId.from(resourceGroup).toString(), 'resourceGroup');

        expect(setup.mockResult.window.showInputBox.mock.callCount()).to.equal(1);
        expect(setup.deleteOperation.mock.callCount()).to.equal(1);
    });

    it('routes an associated resource through azd down', async () => {
        const resource = makeGenericResource();
        const executeAzdDown = mock.fn<AzdDown['execute']>(() => Promise.resolve());
        const setup = createService(resource, {
            azdTarget: resource,
            association: { find: mock.fn(() => Promise.resolve({ azureYamlUri: MockUri.file('/project/azure.yaml'), environmentName: 'dev' })) },
            executeAzdDown,
        });
        setup.mockResult.messageResponses.push('Delete Deployment');

        await setup.service.delete(AzureNodeId.from(resource).toString(), 'resource');

        expect(executeAzdDown.mock.callCount()).to.equal(1);
        expect(executeAzdDown.mock.calls[0].arguments[1]).to.deep.include({ environmentName: 'dev' });
        expect(setup.deleteOperation.mock.callCount()).to.equal(0);
        expect(setup.remove.mock.callCount()).to.equal(0);
    });

    it('allows explicit direct deletion of an azd-associated resource', async () => {
        const resource = makeGenericResource();
        const setup = createService(resource, {
            azdTarget: resource,
            association: { find: mock.fn(() => Promise.resolve({ azureYamlUri: MockUri.file('/project/azure.yaml'), environmentName: 'dev' })) },
        });
        setup.mockResult.messageResponses.push('Delete Resource Anyway', 'Delete');

        await setup.service.delete(AzureNodeId.from(resource).toString(), 'resource');

        expect(setup.deleteOperation.mock.callCount()).to.equal(1);
        expect(setup.remove.mock.callCount()).to.equal(1);
    });

    it('allows a product provider to replace deletion for a virtual child resource', async () => {
        const child = makeVirtualResource();
        const setup = createService(child);
        setup.mockResult.messageResponses.push('Delete');

        await setup.service.delete(AzureNodeId.from(child).toString(), 'resource');

        expect(setup.deleteOperation.mock.callCount()).to.equal(1);
        expect(setup.remove.mock.calls[0].arguments[0]).to.equal(child);
    });

    it('merges an earlier product customization over a generic plan', async () => {
        const resource = makeGenericResource();
        const { vscode: code } = createMockVsCode();
        const generic = planProvider(resource, {
            resourceName: resource.name,
            confirmation: { kind: 'modal', message: 'generic' },
            delete: () => Promise.resolve(),
            cacheTarget: resource,
            successMessage: 'deleted',
        });
        const product = planProvider(resource, {
            confirmation: { kind: 'modal', message: 'custom warning' },
            telemetryType: 'custom',
        });
        const resolver = new ResourceDeletionResolver(code, [product, generic]);

        const plan = await resolver.resolve(resource);

        expect(plan.confirmation).to.deep.equal({ kind: 'modal', message: 'custom warning' });
        expect(plan.resourceName).to.equal(resource.name);
        expect(plan.telemetryType).to.equal('custom');
    });
});

interface ServiceOptions {
    readonly confirmation?: ResourceDeletionPlan['confirmation'];
    readonly deleteOperation?: Mock<() => Promise<void>>;
    readonly azdTarget?: GenericResource;
    readonly association?: IAzdResourceAssociationService;
    readonly executeAzdDown?: Mock<AzdDown['execute']>;
}

function createService(resource: ConcreteAzureNode, options: ServiceOptions = {}) {
    const mockResult = createMockVsCode();
    const code = mockResult.vscode;
    const dataTree = createMockDataItemTree([resource]);
    const remove = (dataTree as unknown as { remove: ReturnType<typeof mock.fn> }).remove;
    const deleteOperation = options.deleteOperation ?? mock.fn(() => Promise.resolve());
    const resourceName = isGenericResource(resource) || isResourceGroup(resource) ? resource.name : 'child resource';
    const provider = planProvider(resource, {
        resourceName,
        confirmation: options.confirmation ?? { kind: 'modal', message: 'Delete?' },
        delete: deleteOperation,
        cacheTarget: resource,
        successMessage: 'Deleted.',
        azdTarget: options.azdTarget,
    });
    const resolver = new ResourceDeletionResolver(code, [provider]);
    const association = options.association ?? { find: mock.fn(() => Promise.resolve(undefined)) };
    const container = new Container();
    const executeAzdDown = options.executeAzdDown ?? mock.fn<AzdDown['execute']>(() => Promise.resolve());
    container.bind(AzdDown).toConstantValue({ execute: executeAzdDown } as unknown as AzdDown);
    const service = new ResourceDeletionService(
        code,
        createActionContext('deleteResource'),
        dataTree,
        association,
        resolver,
        container,
    );

    return { service, code, mockResult, deleteOperation, executeAzdDown, remove };
}

function planProvider(
    resource: ConcreteAzureNode,
    plan: Partial<ResourceDeletionPlan>,
): ResourceDeletionProvider {
    return {
        canHandle: candidate => candidate === resource,
        getPlan: () => plan,
    };
}
