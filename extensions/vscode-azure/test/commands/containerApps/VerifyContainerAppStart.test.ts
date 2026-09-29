/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IContainerAppsClientProvider, type ContainerApp, type Revision } from '@microsoft/vscode-azure-azutils';
import { createMockContainerAppsClient, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { CommandRegistry, createActionContext, IActionContext, ICodeContext, ICommandRegistry, IVsCode } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, createTestActionExecutor, MockCancellationToken, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { Container } from 'inversify';
import { setImmediate } from 'node:timers/promises';
import { mock } from 'node:test';
import { VerifyContainerAppStart, type VerifyContainerAppStartRequest } from '../../../src/commands/containerApps/VerifyContainerAppStart';
import { StartStreamingLogs, type StartStreamingLogsRequest } from '../../../src/commands/containerApps/StartStreamingLogs';
import { toActivityTreeItem } from '../../../src/tree/activity/ActivityViewProvider';
import { IContainerAppLogStreamService, type ContainerAppLogStreamTarget } from '../../../src/tree/resources/containerApps/ContainerAppLogStream';
import { IResourceSelector } from '../../../src/tree/resources/ResourceSelector';
import { createTestResourceSelector } from '../../tree/resources/testResourceSelector';
import { VerifyContainerAppStartStep } from '../../../src/commands/containerApps/steps/VerifyContainerAppStartStep';
import { registerCommands } from '../../../src/commands/registerCommands';
import { registerContainerApps } from '../../../src/products/registerContainerApps';
import { ProductRegistrar } from '../../../src/registration/ProductRegistrar';
import { CodeDeploymentDataProvider, ICodeDeploymentDataProvider } from '../../../src/tree/activity/CodeDeploymentDataProvider';
import { createMockAzdService } from '../../azd/MockAzdService';

const request: VerifyContainerAppStartRequest = {
    subscription: makeSubscription(), resourceGroupName: 'rg', appName: 'app',
};

describe('VerifyContainerAppStart (unit)', () => {
    beforeEach(() => {
        mock.timers.enable({ apis: ['setTimeout'] });
        // Native AbortSignal.timeout uses internal timers, outside Node's mock clock.
        mock.method(AbortSignal, 'timeout', (ms: number) => {
            const controller = new AbortController();
            setTimeout(() => { controller.abort(); }, ms);
            return controller.signal;
        });
    });

    afterEach(() => {
        mock.timers.reset();
        mock.restoreAll();
    });

    function createCommand(revision: Partial<Revision> = {}, app: Partial<ContainerApp> = {}) {
        const code = createMockVsCode();
        const context = createActionContext('verify');
        const activities = new CodeDeploymentDataProvider();
        const client = createMockContainerAppsClient({
            environmentId: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/managedEnvironments/env',
            latestRevisionName: 'app--first',
            ...app,
        });
        client.containerAppsRevisions.getRevision.mock.mockImplementation(() => Promise.resolve({
            id: '/revisions/app--first', name: 'app--first', type: 'Microsoft.App/containerApps/revisions',
            provisioningState: 'Provisioned', runningState: 'Running', ...revision,
        }));
        const azd = createMockAzdService();
        azd.envGetValues.mock.mockImplementation(() => Promise.resolve({
            // eslint-disable-next-line @typescript-eslint/naming-convention -- azd output keys
            AZURE_CONTAINER_APP_NAME: 'app',
            // eslint-disable-next-line @typescript-eslint/naming-convention -- azd output keys
            AZURE_RESOURCE_GROUP: 'rg',
        }));
        const resolveSubscription = mock.fn(() => Promise.resolve(makeSubscription()));
        const command = new VerifyContainerAppStart(
            code.vscode, context, () => client, activities,
        );
        return { command, code, context, activities, client, azd, resolveSubscription };
    }

    it('runs the registered background command in its own scope after the launcher completes', async () => {
        const { code, context, activities, client, azd, resolveSubscription } = createCommand({ runningState: 'Processing' });
        const { executor, reporter } = createTestActionExecutor();
        const telemetry = mock.method(reporter, 'sendTelemetryErrorEvent');
        const container = new Container();
        container.bind(IVsCode).toConstantValue(code.vscode);
        container.bind(IActionContext).toConstantValue(context);
        container.bind(IContainerAppsClientProvider).toConstantValue(() => client);
        container.bind(ICodeDeploymentDataProvider).toConstantValue(activities);
        const registry = new CommandRegistry(executor, code.vscode);
        container.bind(ICommandRegistry).toConstantValue(registry);
        const registrar = new ProductRegistrar();
        registerContainerApps(registrar);
        registerCommands(container, registrar.getCommands());
        const handler = code.registeredCommands.get(VerifyContainerAppStart.CommandId);
        if (!handler) {
            throw new Error('Expected registered verification command');
        }
        const dispatch = mock.method(code.vscode.commands, 'executeCommand', (...args: unknown[]) => Promise.resolve(handler(...args.slice(1))));

        await new VerifyContainerAppStartStep(code.vscode, azd, resolveSubscription).execute({
            subscription: request.subscription, iacFolder: MockUri.file('/project'), environmentName: 'dev',
            deploy: true, resourceDisplayName: 'Container App',
        });
        await setImmediate();

        expect((await activities.getChildren())[0].status).to.equal('InProgress');
        expect(context.errorHandling.suppress).to.equal(undefined);
        expect(context.telemetry.isUserEvent).to.equal(undefined);
        const polled = await client.containerAppsRevisions.getRevision.mock.calls[0].result;
        if (!polled) {
            throw new Error('Expected polled revision');
        }
        client.containerAppsRevisions.getRevision.mock.mockImplementation(() => Promise.resolve({ ...polled, runningState: 'Running' }));
        mock.timers.tick(5_000);
        await dispatch.mock.calls[0].result;

        expect((await activities.getChildren())[0].status).to.equal('Completed');
        expect(azd.envGetValues.mock.callCount()).to.equal(1);
        expect(resolveSubscription.mock.callCount()).to.equal(0);
        expect(telemetry.mock.calls.some(call => call.arguments[0] === VerifyContainerAppStart.CommandId)).to.be.true;
        registry.dispose();
    });

    for (const runningState of ['Running', 'ScaledToZero', 'running']) {
        it(`completes an independent root for a provisioned ${runningState} revision`, async () => {
            const { command, activities, context } = createCommand({ runningState });
            const deployment = activities.trackDeployment({ title: 'azd deploy' });
            deployment.complete('Completed');

            await command.execute(request);

            const roots = await activities.getChildren();
            expect(roots).to.have.length(2);
            expect(roots[0].id).to.equal(deployment.id);
            expect(roots[1].id).not.to.equal(deployment.id);
            expect(roots.map(root => root.status)).to.deep.equal(['Completed', 'Completed']);
            expect(roots[1].endTime).to.be.instanceOf(Date);
            expect(context.telemetry.isUserEvent).to.be.false;
            expect(context.errorHandling.suppress).to.equal('display');
        });
    }

    it('polls both states and keeps the captured revision even if latest changes', async () => {
        const { command, client, activities } = createCommand({ provisioningState: 'Provisioning' });
        const result = command.execute(request);
        await setImmediate();
        expect((await activities.getChildren())[0].status).to.equal('InProgress');
        const revisionMock = client.containerAppsRevisions.getRevision.mock;
        const first = await revisionMock.calls[0].result;
        if (!first) {
            throw new Error('Expected a polled revision');
        }
        client.containerApps.get.mock.mockImplementation(() => Promise.reject(new Error('Must not follow a newer revision')));
        revisionMock.mockImplementation(() => Promise.resolve({ ...first, provisioningState: 'Provisioned' }));
        mock.timers.tick(5_000);
        await result;
        expect(revisionMock.callCount()).to.be.greaterThan(1);
        expect(revisionMock.calls.every(call => call.arguments[2] === 'app--first')).to.be.true;
        expect(client.containerApps.get.mock.callCount()).to.equal(1);
        expect(client.containerApps.get.mock.calls[0].arguments.slice(0, 2)).to.deep.equal(['rg', 'app']);
        expect((await activities.getChildren())[0].status).to.equal('Completed');
    });

    it('routes activity selections through registered commands without a cached app', async () => {
        const { command, activities, client, code } = createCommand({ runningState: 'Failed' });
        await expect(command.execute(request)).to.be.rejectedWith('did not start successfully');
        const { selector, ctx } = createTestResourceSelector();
        const select = mock.method(selector, 'selectResource');
        const enrich = mock.method(selector, 'whenEnriched');
        const start = mock.fn((_target: ContainerAppLogStreamTarget) => Promise.resolve());
        client.containerAppsRevisionReplicas.listReplicas.mock.mockImplementation(() => Promise.resolve([
            { name: 'replica', containers: [{ name: 'api', logStreamEndpoint: 'https://app.region.azurecontainerapps.io/logstream' }] },
        ]));
        const { executor } = createTestActionExecutor();
        const registry = new CommandRegistry(executor, code.vscode);
        const container = new Container();
        container.bind(IVsCode).toConstantValue(code.vscode);
        container.bind(ICodeContext).toConstantValue(ctx);
        container.bind(ICommandRegistry).toConstantValue(registry);
        container.bind(IContainerAppsClientProvider).toConstantValue(() => client);
        container.bind(IResourceSelector).toConstantValue(selector);
        container.bind(IContainerAppLogStreamService).toConstantValue({ start } as never);
        const registrar = new ProductRegistrar();
        registerContainerApps(registrar);
        registerCommands(container, registrar.getCommands());

        const [root] = await activities.getChildren();
        for (const child of await activities.getChildren(root)) {
            const action = toActivityTreeItem(code.vscode, child, child.id).command;
            if (action) {
                const handler = code.registeredCommands.get(action.command);
                if (!handler) {
                    throw new Error('Expected registered shortcut command');
                }
                await handler(...action.arguments ?? []);
            }
        }

        expect(start.mock.callCount()).to.equal(2);
        expect(start.mock.calls[0].arguments[0].kind).to.equal('system');
        expect(start.mock.calls[1].arguments[0]).to.include({ revisionName: 'app--first', replicaName: 'replica', containerName: 'api' });
        expect(client.containerAppsRevisionReplicas.listReplicas.mock.calls[0].arguments.slice(0, 3)).to.deep.equal(['rg', 'app', 'app--first']);
        expect(select.mock.callCount()).to.equal(0);
        expect(enrich.mock.callCount()).to.equal(0);
        expect(client.containerAppsRevisions.listRevisions.mock.callCount()).to.equal(0);
        registry.dispose();
    });

    for (const revision of [
        { provisioningState: 'Failed', runningState: 'Running' },
        { provisioningState: 'Provisioned', runningState: 'Failed' },
        { provisioningState: 'Provisioned', runningState: 'Degraded' },
        { provisioningState: 'Provisioned', runningState: 'Stopped' },
        { provisioningState: 'Deprovisioned', runningState: 'Running' },
    ]) {
        it(`fails for ${revision.provisioningState}/${revision.runningState} and offers targeted log actions`, async () => {
            const { command, activities } = createCommand(revision);
            await expect(command.execute(request)).to.be.rejectedWith('did not start successfully');
            const [root] = await activities.getChildren();
            expect(root.status).to.equal('Failed');
            const children = await activities.getChildren(root);
            const shortcuts = children.filter(child => child.command);
            expect(shortcuts.map(child => child.title)).to.deep.equal(['Open System Log Stream', 'Open App Log Stream']);
            expect(shortcuts.every(child => child.isLeaf)).to.be.true;
            expect(shortcuts.map(child => child.command?.command)).to.deep.equal([
                StartStreamingLogs.CommandId, StartStreamingLogs.CommandId,
            ]);
            const targets = shortcuts.map(child => child.command?.arguments?.[0] as StartStreamingLogsRequest);
            expect(targets[0].kind).to.equal('system');
            expect(targets[1]).to.include({ kind: 'console', revisionName: 'app--first' });
            expect(targets.every(target => target.app.name === request.appName && target.app.subscription === request.subscription)).to.be.true;
        });
    }

    it('records a visible lookup failure for an unavailable revision', async () => {
        const { command, activities, client } = createCommand();
        client.containerAppsRevisions.getRevision.mock.mockImplementation(() => Promise.reject(new Error('404')));
        await expect(command.execute(request)).to.be.rejectedWith('Unable to verify');
        expect((await activities.getChildren())[0].status).to.equal('Failed');
    });

    for (const missingRevision of [false, true]) {
        it(`fails its independent activity for ${missingRevision ? 'a missing latest revision' : 'an app lookup error'}`, async () => {
            const { command, activities, client } = createCommand({}, { latestRevisionName: undefined });
            if (!missingRevision) {
                client.containerApps.get.mock.mockImplementation(() => Promise.reject(new Error('private app lookup failure')));
            }
            await expect(command.execute(request)).to.be.rejectedWith(missingRevision ? 'no latest revision' : 'Unable to verify');
            const [root] = await activities.getChildren();
            expect(root.status).to.equal('Failed');
            const shortcuts = (await activities.getChildren(root)).filter(child => child.command);
            expect(shortcuts).to.have.length(2);
            expect(shortcuts[1].command?.arguments?.[0]).to.include({ kind: 'console', revisionName: undefined });
            expect(shortcuts.every(child => child.command?.arguments?.[0].app.name === request.appName)).to.be.true;
            expect(client.containerAppsRevisions.getRevision.mock.callCount()).to.equal(0);
        });
    }

    for (const canceled of [false, true]) {
        it(`bounds an app lookup with ${canceled ? 'cancellation' : 'the startup timeout'} and ignores its late result`, async () => {
            const { command, activities, client } = createCommand();
            const pending = Promise.withResolvers<ContainerApp>();
            const app = await client.containerApps.get('rg', 'app');
            client.containerApps.get.mock.resetCalls();
            client.containerApps.get.mock.mockImplementation(() => pending.promise);
            const token = new MockCancellationToken();
            const result = expect(command.execute(request, token)).to.be.rejectedWith(canceled ? 'Canceled' : 'timed out');
            await setImmediate();
            expect((await activities.getChildren())[0].status).to.equal('InProgress');
            if (canceled) {
                token.cancel();
            } else {
                mock.timers.tick(120_000);
            }
            await result;
            expect(client.containerApps.get.mock.calls[0].arguments[2]?.abortSignal?.aborted).to.be.true;
            pending.resolve(app);
            await setImmediate();
            expect((await activities.getChildren())[0].status).to.equal(canceled ? 'Canceled' : 'Failed');
            expect(client.containerAppsRevisions.getRevision.mock.callCount()).to.equal(0);
            token.dispose();
        });
    }

    for (const missingState of [false, true]) {
        it(`times out ${missingState ? 'missing' : 'transient'} states without waiting in real time`, async () => {
            const { command, activities, client } = createCommand(missingState
                ? { provisioningState: undefined, runningState: undefined }
                : { provisioningState: 'Provisioning', runningState: 'Processing' });
            const result = expect(command.execute(request)).to.be.rejectedWith('timed out');
            await setImmediate();
            mock.timers.tick(120_000);
            await result;
            expect((await activities.getChildren())[0].status).to.equal('Failed');
            expect(client.containerAppsRevisions.getRevision.mock.calls[0].arguments[3]?.abortSignal?.aborted).to.be.true;
        });
    }

    it('bounds a hung revision lookup and ignores its late result', async () => {
        const { command, activities, client } = createCommand();
        const revision = await client.containerAppsRevisions.getRevision('rg', 'app', 'app--first');
        const pending = Promise.withResolvers<Revision>();
        client.containerAppsRevisions.getRevision.mock.mockImplementation(() => pending.promise);
        const result = expect(command.execute(request)).to.be.rejectedWith('timed out');
        await setImmediate();
        mock.timers.tick(120_000);
        await result;
        pending.resolve(revision);
        await setImmediate();
        expect((await activities.getChildren())[0].status).to.equal('Failed');
    });

    for (const alreadyCanceled of [false, true]) {
        it(`honors ${alreadyCanceled ? 'preexisting' : 'in-flight'} cancellation`, async () => {
            const { command, activities } = createCommand({ runningState: 'Processing' });
            const token = new MockCancellationToken();
            if (alreadyCanceled) {
                token.cancel();
            }
            const result = expect(command.execute(request, token)).to.be.rejectedWith('Canceled');
            await setImmediate();
            token.cancel();
            await result;
            expect((await activities.getChildren())[0].status).to.equal('Canceled');
            token.dispose();
        });
    }
});
