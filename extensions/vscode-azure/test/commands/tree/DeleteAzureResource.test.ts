/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, IResourceClientProvider, type ConcreteAzureNode, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { createMockDataItemTree, makeGenericResource, makeResourceGroup, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { CancellationError, createActionContext, IActionContext, ICodeContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockUri, respondToPrompts, type MockInputBox, type MockVsCodeResult } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { Container } from 'inversify';
import * as assert from 'node:assert';
import { mock, type Mock } from 'node:test';
import type { AzdResourceAssociation } from '../../../src/azd/AzdResourceAssociationService';
import { IAzdResourceAssociationService } from '../../../src/azd/AzdResourceAssociationService';
import { AzdDown } from '../../../src/commands/deploy/AzdDown';
import { DeleteAzureResource } from '../../../src/commands/tree/DeleteAzureResource';
import { IAzureViewDataTree } from '../../../src/services';

describe('DeleteAzureResource (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('deletes a confirmed resource by id and type, then removes it from the tree', async () => {
        const resource = makeGenericResource();
        const setup = createCommand(resource);
        setup.mockResult.messageResponses.push('Delete');

        await setup.command.execute(AzureNodeId.from(resource).toString());

        expect(setup.deleteById.mock.callCount()).to.equal(1);
        expect(setup.deleteById.mock.calls[0].arguments).to.deep.equal([resource.id, resource.type]);
        expect(setup.deleteResourceGroup.mock.callCount()).to.equal(0);
        expect(setup.remove.mock.calls[0].arguments[0]).to.equal(resource);
        expect(shownToasts(setup)).to.deep.equal([`Deleted resource '${resource.name}'.`]);
    });

    it('does not remove the node when the remote delete fails', async () => {
        const resource = makeGenericResource();
        const failure = new Error('delete failed');
        const setup = createCommand(resource, { deleteById: mock.fn(() => Promise.reject(failure)) });
        setup.mockResult.messageResponses.push('Delete');

        await assert.rejects(setup.command.execute(AzureNodeId.from(resource).toString()), failure);

        expect(setup.remove.mock.callCount()).to.equal(0);
        expect(shownToasts(setup)).to.be.empty;
    });

    it('does not delete a resource when the confirmation is dismissed', async () => {
        const resource = makeGenericResource();
        const setup = createCommand(resource);

        await setup.command.execute(AzureNodeId.from(resource).toString());

        expect(setup.deleteById.mock.callCount()).to.equal(0);
        expect(setup.remove.mock.callCount()).to.equal(0);
        expect(shownToasts(setup)).to.be.empty;
    });

    it('deletes a resource group only after its name is typed', async () => {
        const resourceGroup = makeResourceGroup();
        const setup = createCommand(resourceGroup);
        const tracker = respondToPrompts(setup.mockResult, [{ input: resourceGroup.name }]);

        await setup.command.execute(AzureNodeId.from(resourceGroup).toString());

        tracker.assertAllConsumed();
        expect(setup.deleteResourceGroup.mock.calls[0].arguments[0]).to.equal(resourceGroup.name);
        expect(setup.deleteById.mock.callCount()).to.equal(0);
        expect(setup.remove.mock.calls[0].arguments[0]).to.equal(resourceGroup);
        expect(shownToasts(setup)).to.deep.equal([`Deleted resource group '${resourceGroup.name}'.`]);
    });

    it('blocks deletion while the typed name does not match the resource group', async () => {
        const resourceGroup = makeResourceGroup();
        const setup = createCommand(resourceGroup);
        respondToPrompts(setup.mockResult, [{ input: 'not-the-name' }]);

        const pending = setup.command.execute(AzureNodeId.from(resourceGroup).toString());
        const inputBox = await waitForInputBox(setup.mockResult);

        // Validation refused the accept, so the prompt stays open and nothing is deleted.
        expect(inputBox.validationMessage).to.be.a('string').that.includes(resourceGroup.name);
        expect(setup.deleteResourceGroup.mock.callCount()).to.equal(0);

        inputBox.triggerHide();
        await assert.rejects(pending, (error: unknown) => CancellationError.test(error));
        expect(setup.remove.mock.callCount()).to.equal(0);
        expect(shownToasts(setup)).to.be.empty;
    });

    it('does not delete a resource group when the typed confirmation is cancelled', async () => {
        const resourceGroup = makeResourceGroup();
        const setup = createCommand(resourceGroup);
        respondToPrompts(setup.mockResult, ['cancel']);

        await assert.rejects(
            setup.command.execute(AzureNodeId.from(resourceGroup).toString()),
            (error: unknown) => CancellationError.test(error),
        );

        expect(setup.deleteResourceGroup.mock.callCount()).to.equal(0);
        expect(setup.remove.mock.callCount()).to.equal(0);
    });

    it('reports success only after a slow delete finishes', async () => {
        const resource = makeGenericResource();
        let finishDelete: (() => void) | undefined;
        const deleteById = mock.fn((_resourceId: string, _resourceType: string) =>
            new Promise<void>(resolve => { finishDelete = resolve; }));
        const setup = createCommand(resource, { deleteById });
        setup.mockResult.messageResponses.push('Delete');

        const pending = setup.command.execute(AzureNodeId.from(resource).toString());

        // withDelayedProgress only surfaces a notification once the work
        // outlives its threshold, so wait for the progress path to engage.
        await waitFor(() => setup.mockResult.window.withProgress.mock.callCount() === 1);

        // Still in flight: no toast and the node is still in the tree.
        expect(deleteById.mock.callCount()).to.equal(1);
        expect(shownToasts(setup)).to.be.empty;
        expect(setup.remove.mock.callCount()).to.equal(0);

        finishDelete?.();
        await pending;

        expect(setup.remove.mock.callCount()).to.equal(1);
        expect(shownToasts(setup)).to.deep.equal([`Deleted resource '${resource.name}'.`]);
    });

    it('routes an azd-managed resource through azd down against the matched environment', async () => {
        const resource = makeGenericResource();
        const setup = createCommand(resource, {
            association: { azureYamlUri: MockUri.file('/project/azure.yaml'), environmentName: 'dev' },
        });
        setup.mockResult.messageResponses.push('Delete Deployment');

        await setup.command.execute(AzureNodeId.from(resource).toString());

        expect(setup.executeAzdDown.mock.callCount()).to.equal(1);
        expect(setup.executeAzdDown.mock.calls[0].arguments[1]).to.deep.include({ environmentName: 'dev' });
        expect(setup.deleteById.mock.callCount()).to.equal(0);
        expect(setup.remove.mock.callCount()).to.equal(0);
    });

    it('still allows deleting an azd-managed resource directly', async () => {
        const resource = makeGenericResource();
        const setup = createCommand(resource, {
            association: { azureYamlUri: MockUri.file('/project/azure.yaml'), environmentName: 'dev' },
        });
        setup.mockResult.messageResponses.push('Delete Resource Anyway', 'Delete');

        await setup.command.execute(AzureNodeId.from(resource).toString());

        expect(setup.executeAzdDown.mock.callCount()).to.equal(0);
        expect(setup.deleteById.mock.callCount()).to.equal(1);
        expect(setup.remove.mock.callCount()).to.equal(1);
    });

    it('does nothing when the azd prompt is dismissed', async () => {
        const resource = makeGenericResource();
        const setup = createCommand(resource, {
            association: { azureYamlUri: MockUri.file('/project/azure.yaml'), environmentName: 'dev' },
        });

        await setup.command.execute(AzureNodeId.from(resource).toString());

        expect(setup.executeAzdDown.mock.callCount()).to.equal(0);
        expect(setup.deleteById.mock.callCount()).to.equal(0);
    });

    it('throws for a missing key and for a node that is no longer cached', async () => {
        const setup = createCommand(makeGenericResource());

        await assert.rejects(setup.command.execute(), /Select an Azure resource/);
        await assert.rejects(setup.command.execute('azr://missing@portal.azure.com/tenants/t1/subscriptions/sub1'), /no longer available/);
    });

    it('throws for a node that is not an Azure resource', async () => {
        const subscription = makeSubscription();
        const setup = createCommand(makeGenericResource(), { extraNodes: [subscription] });

        await assert.rejects(
            setup.command.execute(AzureNodeId.from(subscription).toString()),
            /cannot be deleted/,
        );
    });
});

interface CommandOptions {
    readonly deleteById?: Mock<(resourceId: string, resourceType: string) => Promise<void>>;
    readonly association?: AzdResourceAssociation;
    readonly extraNodes?: readonly ConcreteAzureNode[];
}

interface CommandSetup {
    readonly command: DeleteAzureResource;
    readonly mockResult: MockVsCodeResult;
    readonly deleteById: Mock<(resourceId: string, resourceType: string) => Promise<void>>;
    readonly deleteResourceGroup: Mock<(name: string) => Promise<void>>;
    readonly executeAzdDown: Mock<AzdDown['execute']>;
    readonly remove: Mock<(target: unknown) => void>;
}

/** Yield to the event loop until {@linkcode condition} holds. */
async function waitFor(condition: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 1000 && !condition(); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1));
    }

    expect(condition(), 'Timed out waiting for the expected state').to.be.true;
}

/** Localized information toasts shown by the command, in order. */
function shownToasts(setup: CommandSetup): string[] {
    return setup.mockResult.window.showInformationMessage.mock.calls
        .map(call => call.arguments[0]);
}

/** Wait for the command to open its confirmation prompt. */
async function waitForInputBox(mockResult: MockVsCodeResult): Promise<MockInputBox> {
    await waitFor(() => mockResult.inputBoxes.length > 0);
    return mockResult.inputBoxes[0];
}

function createCommand(resource: GenericResource, options: CommandOptions = {}): CommandSetup {    const { ctx, mock: mockResult } = createMockCodeContext();
    const dataTree = createMockDataItemTree([resource, ...(options.extraNodes ?? [])]);
    const remove = (dataTree as unknown as { remove: Mock<(target: unknown) => void> }).remove;

    const deleteById = options.deleteById ?? mock.fn((_resourceId: string, _resourceType: string) => Promise.resolve());
    const deleteResourceGroup = mock.fn((_name: string) => Promise.resolve());
    const executeAzdDown = mock.fn<AzdDown['execute']>(() => Promise.resolve());
    const azdAssociation: IAzdResourceAssociationService = {
        find: mock.fn(() => Promise.resolve(options.association)),
    };

    const container = new Container();
    container.bind(ICodeContext).toConstantValue(ctx);
    container.bind(IActionContext).toConstantValue(createActionContext('deleteAzureResource'));
    container.bind(IAzureViewDataTree).toConstantValue(dataTree);
    container.bind(IAzdResourceAssociationService).toConstantValue(azdAssociation);
    container.bind(IResourceClientProvider).toConstantValue(() => ({
        resources: { deleteById },
        resourceGroups: { delete: deleteResourceGroup },
    }) as unknown as ReturnType<IResourceClientProvider>);
    container.bind(AzdDown).toConstantValue({ execute: executeAzdDown } as unknown as AzdDown);
    container.bind(Container).toConstantValue(container);
    container.bind(DeleteAzureResource).toSelf();

    return {
        command: container.get(DeleteAzureResource),
        mockResult,
        deleteById,
        deleteResourceGroup,
        executeAzdDown,
        remove,
    };
}
