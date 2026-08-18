/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, IResourceClientProvider, type ConcreteAzureNode, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { createMockDataItemTree, makeGenericResource, makeResourceGroup, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { CancellationError, createActionContext, IActionContext, ICodeContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, respondToPrompts, type MockCodeContextResult, type MockVsCodeResult } from '@microsoft/vscode-azure-utils/testing';
import { Container } from 'inversify';
import { mock, type Mock } from 'node:test';
import { DeleteAzureResource } from '../../../src/commands/tree/DeleteAzureResource';
import { IAzureViewDataTree } from '../../../src/services';
import type { Activity } from '../../../src/tree/activity/Activity';
import { GenericActivityDataProvider, IGenericActivityDataProvider } from '../../../src/tree/activity/GenericActivityDataProvider';

describe('DeleteAzureResource (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('deletes a confirmed resource by id and type, then removes it from the tree', async () => {
        const resource = makeGenericResource();
        const setup = createCommand(resource);
        const tracker = respondToPrompts(setup.mockResult, [{ button: 'Delete' }]);

        await setup.command.execute(AzureNodeId.from(resource).toString());

        tracker.assertAllConsumed();
        expect(setup.deleteById.mock.callCount()).to.equal(1);
        expect(setup.deleteById.mock.calls[0].arguments).to.deep.equal([resource.id, resource.type]);
        expect(setup.deleteResourceGroup.mock.callCount()).to.equal(0);
        expect(setup.remove.mock.calls[0].arguments[0]).to.equal(resource);
        expect((await activities(setup))[0]).to.deep.include({
            status: 'Completed',
            title: `Delete resource '${resource.name}'`,
        });
    });

    it('does not remove the node when the remote delete fails', async () => {
        const resource = makeGenericResource();
        const failure = new Error('delete failed');
        const setup = createCommand(resource, { deleteById: mock.fn(() => Promise.reject(failure)) });
        respondToPrompts(setup.mockResult, [{ button: 'Delete' }]);

        await expect(setup.command.execute(AzureNodeId.from(resource).toString()))
            .to.be.rejectedWith(failure);

        expect(setup.remove.mock.callCount()).to.equal(0);
        expect((await activities(setup))[0]).to.deep.include({
            status: 'Failed',
            description: failure.message,
        });
    });

    it('cancels instead of deleting when the confirmation is dismissed', async () => {
        const resource = makeGenericResource();
        const setup = createCommand(resource);
        respondToPrompts(setup.mockResult, ['cancel']);

        const error = await expect(setup.command.execute(AzureNodeId.from(resource).toString())).to.be.rejected;
        expect(CancellationError.test(error)).to.be.true;
        expect((error as CancellationError).stepName).to.equal('confirmResourceDeletion');

        expect(setup.deleteById.mock.callCount()).to.equal(0);
        expect(setup.remove.mock.callCount()).to.equal(0);
        expect(await activities(setup)).to.be.empty;
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
        expect((await activities(setup))[0]).to.deep.include({
            status: 'Completed',
            title: `Delete resource group '${resourceGroup.name}'`,
        });
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
        // genuinely fresh input box. Cancelling hides it without typing, so its
        // value reflects only what the command pre-filled. A later group with
        // the same name must not inherit the remembered value, or confirming a
        // cascading delete becomes a single Enter.
        const fresh = createMockCodeContext();
        const second = makeResourceGroup();
        const repeat = createCommand(second, {
            codeContext: {
                ctx: { code: fresh.ctx.code, extensionContext: setup.codeContext.ctx.extensionContext },
                mock: fresh.mock,
            },
        });
        respondToPrompts(repeat.mockResult, ['cancel']);

        await expect(repeat.command.execute(AzureNodeId.from(second).toString())).to.be.rejected;

        expect(repeat.mockResult.inputBoxes[0].value, 'the confirmation must start empty').to.equal('');
        expect(repeat.deleteResourceGroup.mock.callCount()).to.equal(0);
    });

    it('blocks deletion while the typed name does not match the resource group', async () => {
        const resourceGroup = makeResourceGroup();
        const setup = createCommand(resourceGroup);
        respondToPrompts(setup.mockResult, [{ input: 'not-the-name' }]);

        const pending = setup.command.execute(AzureNodeId.from(resourceGroup).toString());

        // The queue types the wrong name and accepts, but validation refuses the
        // accept, so the prompt is still open and must be dismissed by hand --
        // respondToPrompts only drives a prompt that actually closes.
        await waitFor(() => setup.mockResult.inputBoxes.length > 0);
        const inputBox = setup.mockResult.inputBoxes[0];

        expect(inputBox.validationMessage).to.be.a('string').that.includes(resourceGroup.name);
        expect(setup.deleteResourceGroup.mock.callCount()).to.equal(0);

        inputBox.triggerHide();
        const error = await expect(pending).to.be.rejected;
        expect(CancellationError.test(error)).to.be.true;
        expect(setup.remove.mock.callCount()).to.equal(0);
        expect(await activities(setup)).to.be.empty;
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
        const tracker = respondToPrompts(setup.mockResult, [{ button: 'Delete' }]);

        const pending = setup.command.execute(AzureNodeId.from(resource).toString());

        // withDelayedProgress only surfaces a notification once the work
        // outlives its threshold, so wait for the progress path to engage.
        await waitFor(() => setup.mockResult.window.withProgress.mock.callCount() === 1);

        // Still in flight: the activity reports progress and the node remains.
        expect(deleteById.mock.callCount()).to.equal(1);
        expect((await activities(setup))[0]).to.deep.include({ status: 'InProgress' });
        expect(setup.remove.mock.callCount()).to.equal(0);

        finishDelete?.();
        await pending;

        expect(setup.remove.mock.callCount()).to.equal(1);
        expect((await activities(setup))[0]).to.deep.include({ status: 'Completed' });
        tracker.assertAllConsumed();
    });

    it('suggests azd down when deleting an azd-tagged resource', async () => {
        const resource = makeGenericResource({ tags: { 'azd-env-name': 'dev' } });
        const setup = createCommand(resource);
        const tracker = respondToPrompts(setup.mockResult, [{ button: 'Delete' }]);

        await setup.command.execute(AzureNodeId.from(resource).toString());

        tracker.assertAllConsumed();
        expect(setup.mockResult.window.showWarningMessage.mock.calls[0].arguments[0]).to.include('azd down');
        expect(setup.deleteById.mock.callCount()).to.equal(1);
    });

    it('suggests azd down when deleting an azd-tagged resource group', async () => {
        const resourceGroup = makeResourceGroup({ tags: { 'AZD-ENV-NAME': 'dev' } });
        const setup = createCommand(resourceGroup);
        const tracker = respondToPrompts(setup.mockResult, [{ input: resourceGroup.name }]);

        await setup.command.execute(AzureNodeId.from(resourceGroup).toString());

        tracker.assertAllConsumed();
        expect(setup.mockResult.inputBoxes[0].prompt).to.include('azd down');
        expect(setup.deleteResourceGroup.mock.callCount()).to.equal(1);
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
    readonly activityProvider: GenericActivityDataProvider;
    readonly remove: Mock<(target: unknown) => void>;
}

/** Yield to the event loop until {@linkcode condition} holds. */
async function waitFor(condition: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 1000 && !condition(); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1));
    }

    expect(condition(), 'Timed out waiting for the expected state').to.be.true;
}

/** Activities recorded by the command, in insertion order. */
function activities(setup: CommandSetup): Promise<Activity[]> {
    return setup.activityProvider.getChildren();
}

function createCommand(resource: GenericResource, options: CommandOptions = {}): CommandSetup {
    const codeContext = options.codeContext ?? createMockCodeContext();
    const { ctx, mock: mockResult } = codeContext;
    const dataTree = createMockDataItemTree([resource, ...(options.extraNodes ?? [])]);
    const remove = (dataTree as unknown as { remove: Mock<(target: unknown) => void> }).remove;

    const deleteById = options.deleteById ?? mock.fn((_resourceId: string, _resourceType: string) => Promise.resolve());
    const deleteResourceGroup = mock.fn((_name: string) => Promise.resolve());
    const activityProvider = new GenericActivityDataProvider();
    const container = new Container();
    container.bind(ICodeContext).toConstantValue(ctx);
    container.bind(IActionContext).toConstantValue(createActionContext('deleteAzureResource'));
    container.bind(IAzureViewDataTree).toConstantValue(dataTree);
    container.bind(IGenericActivityDataProvider).toConstantValue(activityProvider);
    container.bind(IResourceClientProvider).toConstantValue(() => ({
        resources: { deleteById },
        resourceGroups: { delete: deleteResourceGroup },
    }) as unknown as ReturnType<IResourceClientProvider>);
    container.bind(DeleteAzureResource).toSelf();

    return {
        command: container.get(DeleteAzureResource),
        mockResult,
        codeContext,
        deleteById,
        deleteResourceGroup,
        activityProvider,
        remove,
    };
}
