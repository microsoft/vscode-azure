/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, IResourceClientProvider, type ConcreteAzureNode, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { createMockDataItemTree, makeGenericResource, makeResourceGroup, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { CancellationError, createActionContext, IActionContext, ICodeContext, IOutputChannel } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockOutputChannel, MockUri, respondToPrompts, type MockCodeContextResult, type MockInputBox, type MockVsCodeResult } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { Container } from 'inversify';
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

        await expect(setup.command.execute(AzureNodeId.from(resource).toString()))
            .to.be.rejectedWith(failure);

        expect(setup.remove.mock.callCount()).to.equal(0);
        expect(shownToasts(setup)).to.be.empty;
    });

    it('cancels instead of deleting when the confirmation is dismissed', async () => {
        const resource = makeGenericResource();
        const setup = createCommand(resource);

        const error = await expect(setup.command.execute(AzureNodeId.from(resource).toString())).to.be.rejected;
        expect(CancellationError.test(error)).to.be.true;
        expect((error as CancellationError).stepName).to.equal('confirmResourceDeletion');

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

    it('never remembers or pre-fills the typed confirmation', async () => {
        const first = makeResourceGroup();
        const setup = createCommand(first);
        respondToPrompts(setup.mockResult, [{ input: first.name }]);

        await setup.command.execute(AzureNodeId.from(first).toString());
        expect(setup.deleteResourceGroup.mock.callCount()).to.equal(1);

        // The accepted name must not be written to workspace state at all, so
        // it can never be replayed into this or any other prompt.
        const workspaceState = setup.codeContext.ctx.extensionContext.workspaceState;
        expect(workspaceState.keys().filter(key => key.startsWith('recentInput:')), 'the name must not be persisted').to.be.empty;

        // Reuse only the persisted workspace state, so the second prompt is a
        // genuinely fresh input box. No response is queued, so its value
        // reflects only what the command pre-filled. A later group with the
        // same name must not inherit the remembered value, or confirming a
        // cascading delete becomes a single Enter.
        const fresh = createMockCodeContext();
        const second = makeResourceGroup();
        const repeat = createCommand(second, {
            codeContext: {
                ctx: { code: fresh.ctx.code, extensionContext: setup.codeContext.ctx.extensionContext },
                mock: fresh.mock,
            },
        });

        const pending = repeat.command.execute(AzureNodeId.from(second).toString());
        const inputBox = await waitForInputBox(repeat.mockResult);
        expect(inputBox.value, 'the confirmation must start empty').to.equal('');

        inputBox.triggerHide();
        await expect(pending).to.be.rejected;
        expect(repeat.deleteResourceGroup.mock.callCount()).to.equal(0);
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
        const error = await expect(pending).to.be.rejected;
        expect(CancellationError.test(error)).to.be.true;
        expect(setup.remove.mock.callCount()).to.equal(0);
        expect(shownToasts(setup)).to.be.empty;
    });

    it('does not delete a resource group when the typed confirmation is cancelled', async () => {
        const resourceGroup = makeResourceGroup();
        const setup = createCommand(resourceGroup);
        respondToPrompts(setup.mockResult, ['cancel']);

        const error = await expect(setup.command.execute(AzureNodeId.from(resourceGroup).toString()))
            .to.be.rejected;
        expect(CancellationError.test(error)).to.be.true;

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

    it('still allows deleting an azd-managed resource directly, after a second confirmation', async () => {
        const resource = makeGenericResource();
        const setup = createCommand(resource, {
            association: { azureYamlUri: MockUri.file('/project/azure.yaml'), environmentName: 'dev' },
        });
        setup.mockResult.messageResponses.push('Delete Resource Anyway', 'Delete');

        await setup.command.execute(AzureNodeId.from(resource).toString());

        // Choosing to bypass azd must not also bypass the delete confirmation:
        // one warning steers toward azd, a second confirms the deletion.
        const warnings = setup.mockResult.window.showWarningMessage.mock.calls
            .map(call => call.arguments[0]);
        expect(warnings).to.have.length(2);
        expect(warnings[1]).to.contain(resource.name);
        expect(setup.mockResult.messageResponses, 'both responses should be consumed').to.be.empty;
        expect(setup.executeAzdDown.mock.callCount()).to.equal(0);
        expect(setup.deleteById.mock.callCount()).to.equal(1);
        expect(setup.remove.mock.callCount()).to.equal(1);
    });

    it('still deletes when the azd lookup fails, e.g. azd is not installed', async () => {
        const resource = makeGenericResource();
        const setup = createCommand(resource, {
            associationError: new Error('Azure Developer CLI (azd) was not found'),
        });
        setup.mockResult.messageResponses.push('Delete');

        await setup.command.execute(AzureNodeId.from(resource).toString());

        // A missing azd must not make the resource undeletable; it falls
        // through to the normal confirm-and-delete path.
        expect(setup.executeAzdDown.mock.callCount()).to.equal(0);
        expect(setup.deleteById.mock.callCount()).to.equal(1);
        expect(setup.remove.mock.callCount()).to.equal(1);
    });

    it('cancels when the azd prompt is dismissed', async () => {
        const resource = makeGenericResource();
        const setup = createCommand(resource, {
            association: { azureYamlUri: MockUri.file('/project/azure.yaml'), environmentName: 'dev' },
        });

        const error = await expect(setup.command.execute(AzureNodeId.from(resource).toString())).to.be.rejected;
        expect(CancellationError.test(error)).to.be.true;
        expect((error as CancellationError).stepName).to.equal('confirmAzdDeletionChoice');

        expect(setup.executeAzdDown.mock.callCount()).to.equal(0);
        expect(setup.deleteById.mock.callCount()).to.equal(0);
    });

    it('throws for a missing key and for a node that is no longer cached', async () => {
        const setup = createCommand(makeGenericResource());

        await expect(setup.command.execute()).to.be.rejectedWith(/Select an Azure resource/);
        await expect(setup.command.execute('azr://missing@portal.azure.com/tenants/t1/subscriptions/sub1'))
            .to.be.rejectedWith(/no longer available/);
    });

    it('throws for a node that is not an Azure resource', async () => {
        const subscription = makeSubscription();
        const setup = createCommand(makeGenericResource(), { extraNodes: [subscription] });

        await expect(setup.command.execute(AzureNodeId.from(subscription).toString()))
            .to.be.rejectedWith(/cannot be deleted/);
    });
});

interface CommandOptions {
    readonly deleteById?: Mock<(resourceId: string, resourceType: string) => Promise<void>>;
    readonly association?: AzdResourceAssociation;
    /** Simulate an azd lookup that fails, e.g. because azd is not installed. */
    readonly associationError?: Error;
    readonly extraNodes?: readonly ConcreteAzureNode[];
    /** Reuse a context (and its workspace state) from an earlier invocation. */
    readonly codeContext?: MockCodeContextResult;
}

interface CommandSetup {
    readonly command: DeleteAzureResource;
    readonly mockResult: MockVsCodeResult;
    readonly codeContext: MockCodeContextResult;
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

function createCommand(resource: GenericResource, options: CommandOptions = {}): CommandSetup {
    const codeContext = options.codeContext ?? createMockCodeContext();
    const { ctx, mock: mockResult } = codeContext;
    const dataTree = createMockDataItemTree([resource, ...(options.extraNodes ?? [])]);
    const remove = (dataTree as unknown as { remove: Mock<(target: unknown) => void> }).remove;

    const deleteById = options.deleteById ?? mock.fn((_resourceId: string, _resourceType: string) => Promise.resolve());
    const deleteResourceGroup = mock.fn((_name: string) => Promise.resolve());
    const executeAzdDown = mock.fn<AzdDown['execute']>(() => Promise.resolve());
    const azdAssociation: IAzdResourceAssociationService = {
        find: mock.fn(() => options.associationError
            ? Promise.reject(options.associationError)
            : Promise.resolve(options.association)),
    };

    const container = new Container();
    container.bind(ICodeContext).toConstantValue(ctx);
    container.bind(IActionContext).toConstantValue(createActionContext('deleteAzureResource'));
    container.bind(IOutputChannel).toConstantValue(new MockOutputChannel('test'));
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
        codeContext,
        deleteById,
        deleteResourceGroup,
        executeAzdDown,
        remove,
    };
}
