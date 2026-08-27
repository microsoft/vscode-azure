/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzurePublicCloud, type AzureSubscriptionTarget, type CredentialFactoryOptions } from '@microsoft/vscode-azure-azutils';
import { createMockAccountDataProvider } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode, createTestActionExecutor, waitFor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { ArmDeploymentDataProvider, isNestedDeploymentOp, isVisibleOperation, parseDeploymentId, type ArmDeploymentActivity } from '../../../src/tree/activity/ArmDeploymentDataProvider';
import { CredentialOptionsScope } from '../../../src/utils/CredentialOptionsScope';
import { makeActivity, makeOperationActivity } from './mockActivity';

/** Creates a mock IDeploymentClient that returns the given operations and deployment state. */
function createMockClient(
    operations: Array<{ operationId: string; targetId: string; targetType: string; targetName: string; provisioningOperation?: string; provisioningState?: string }> = [],
    deploymentState: string | string[] = 'Running',
    retryAfter?: string,
    /** Zero-based index of a `getAtScope` attempt that should reject, simulating a transient failure. */
    failAtAttempt?: number,
) {
    let deploymentRequest = 0;
    let attempt = 0;
    return {
        deployments: {
            getAtScope: mock.fn((_scope: string, _name: string, options?: { onResponse?: (r: { status: number; headers: { get: (name: string) => string | undefined } }) => void }) => {
                const currentAttempt = attempt++;
                if (currentAttempt === failAtAttempt) {
                    return Promise.reject(new Error('transient failure'));
                }
                options?.onResponse?.({ status: 200, headers: { get: name => name === 'retry-after' ? retryAfter : undefined } });
                const states = Array.isArray(deploymentState) ? deploymentState : [deploymentState];
                const provisioningState = states[Math.min(deploymentRequest++, states.length - 1)];
                return Promise.resolve({
                    id: 'deploy-id',
                    name: 'deploy',
                    type: 'Microsoft.Resources/deployments',
                    properties: { provisioningState },
                });
            }),
        },
        deploymentOperations: {
            listAtScope() {
                // eslint-disable-next-line @typescript-eslint/require-await
                return (async function* () {
                    yield {
                        items: operations.map(op => ({
                            operationId: op.operationId,
                            properties: {
                                provisioningOperation: op.provisioningOperation ?? 'Create',
                                provisioningState: op.provisioningState ?? 'Running',
                                targetResource: {
                                    id: op.targetId,
                                    resourceType: op.targetType,
                                    resourceName: op.targetName,
                                },
                            },
                        })),
                        hasMore: false,
                    };
                })();
            },
        },
    };
}

describe('parseDeploymentId (unit)', () => {
    it('should parse a resource-group-scoped deployment', () => {
        const id = '/subscriptions/abc/resourceGroups/rg1/providers/Microsoft.Resources/deployments/myDeploy';
        const result = parseDeploymentId(id);
        expect(result.scope).to.equal('/subscriptions/abc/resourceGroups/rg1');
        expect(result.deploymentName).to.equal('myDeploy');
    });

    it('should parse a subscription-scoped deployment', () => {
        const id = '/subscriptions/abc/providers/Microsoft.Resources/deployments/subDeploy';
        const result = parseDeploymentId(id);
        expect(result.scope).to.equal('/subscriptions/abc');
        expect(result.deploymentName).to.equal('subDeploy');
    });

    it('should parse a tenant-scoped deployment', () => {
        const id = '/providers/Microsoft.Resources/deployments/tenantDeploy';
        const result = parseDeploymentId(id);
        expect(result.scope).to.equal('');
        expect(result.deploymentName).to.equal('tenantDeploy');
    });

    it('should be case-insensitive for the deployments segment', () => {
        const id = '/subscriptions/abc/PROVIDERS/MICROSOFT.RESOURCES/DEPLOYMENTS/myDeploy';
        const result = parseDeploymentId(id);
        expect(result.deploymentName).to.equal('myDeploy');
    });

    it('should throw for an ID without a deployments segment', () => {
        expect(() => parseDeploymentId('/subscriptions/abc/resourceGroups/rg1')).to.throw('Not an ARM deployment');
    });

    it('should throw for a deployment ID missing the name', () => {
        expect(() => parseDeploymentId('/subscriptions/abc/providers/Microsoft.Resources/deployments/')).to.throw('missing a deployment name');
    });
});

describe('isVisibleOperation (unit)', () => {
    it('should return true for a normal resource operation', () => {
        expect(isVisibleOperation(makeOperationActivity())).to.be.true;
    });

    it('should return false for AVM telemetry deployments', () => {
        const op = makeOperationActivity({
            targetResourceType: 'Microsoft.Resources/deployments',
            targetResourceName: '46d3xSomeTelemetryDeployment',
        });
        expect(isVisibleOperation(op)).to.be.false;
    });

    it('should return true for nested deployments without AVM prefix', () => {
        const op = makeOperationActivity({
            targetResourceType: 'Microsoft.Resources/deployments',
            targetResourceName: 'myNestedDeploy',
        });
        expect(isVisibleOperation(op)).to.be.true;
    });
});

describe('isNestedDeploymentOp (unit)', () => {
    it('should return true for deployment resource type', () => {
        const op = makeOperationActivity({ targetResourceType: 'Microsoft.Resources/deployments' });
        expect(isNestedDeploymentOp(op)).to.be.true;
    });

    it('should be case-insensitive', () => {
        const op = makeOperationActivity({ targetResourceType: 'MICROSOFT.RESOURCES/DEPLOYMENTS' });
        expect(isNestedDeploymentOp(op)).to.be.true;
    });

    it('should return false for non-deployment resource type', () => {
        expect(isNestedDeploymentOp(makeOperationActivity())).to.be.false;
    });
});

describe('ArmDeploymentDataProvider (unit)', () => {
    function createProvider(clientOrFactory?: unknown) {
        const { executor } = createTestActionExecutor();
        const { vscode } = createMockVsCode();
        const createClientFn = clientOrFactory
            ? mock.fn(() => clientOrFactory)
            : mock.fn(() => ({}));
        return new ArmDeploymentDataProvider(vscode, executor, createClientFn as never, new CredentialOptionsScope(), createMockAccountDataProvider());
    }

    /**
     * Resolves on the change event fired for the poll response that moved the
     * activity to `Completed`. That event is emitted while the final response is
     * being applied, so the poller itself may not have unwound yet -- but no
     * further requests follow a terminal response, so request counts are stable.
     */
    function waitForCompletedStatus(provider: ArmDeploymentDataProvider, activity: ArmDeploymentActivity): Promise<void> {
        return new Promise<void>(resolve => {
            const subscription = provider.onDidChange(() => {
                if (activity.status === 'Completed') {
                    subscription.dispose();
                    resolve();
                }
            });
        });
    }

    describe('canHandle', () => {
        it('should return true for armDeployment activities', () => {
            const provider = createProvider();
            expect(provider.canHandle(makeActivity({ type: 'armDeployment' }))).to.be.true;
        });

        it('should return false for non-armDeployment activities', () => {
            const provider = createProvider();
            expect(provider.canHandle(makeActivity())).to.be.false;
        });

        it('should return false for non-activity values', () => {
            const provider = createProvider();
            expect(provider.canHandle('string')).to.be.false;
            expect(provider.canHandle(null)).to.be.false;
        });
    });

    describe('trackDeployment', () => {
        it('should add a deployment and return it from getChildren', () => {
            const provider = createProvider();
            const deploymentId = '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Resources/deployments/myDeploy';

            provider.trackDeployment(deploymentId);

            const roots = provider.getChildren();
            expect(roots).to.have.length(1);
            expect(roots[0].deploymentName).to.equal('myDeploy');
            expect(roots[0].status).to.equal('InProgress');
            expect(roots[0].subscription.subscriptionId).to.equal('test-sub');
        });

        it('should populate scope from the deployment ID', () => {
            const provider = createProvider();
            provider.trackDeployment('/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.Resources/deployments/d1');

            const activity = provider.getChildren()[0];
            expect(activity.scope).to.equal('/subscriptions/sub/resourceGroups/rg1');
            expect(activity.rootDeploymentId).to.equal(activity.id);
        });

        it('should store the tenantId hint on the tracked deployment', () => {
            const provider = createProvider();
            provider.trackDeployment('/subscriptions/test-sub/providers/Microsoft.Resources/deployments/d1', 'tenant-9');

            expect(provider.getChildren()[0].subscription.tenantId).to.equal('tenant-9');
        });

        it('should leave the tenantId unset when no hint is provided', () => {
            const provider = createProvider();
            provider.trackDeployment('/subscriptions/test-sub/providers/Microsoft.Resources/deployments/d1');

            expect(provider.getChildren()[0].subscription.tenantId).to.be.undefined;
        });

        it('should store the accountId hint on the tracked deployment', () => {
            const provider = createProvider();
            provider.trackDeployment('/subscriptions/test-sub/providers/Microsoft.Resources/deployments/d1', 'tenant-9', 'acct-9');

            expect(provider.getChildren()[0].subscription.accountId).to.equal('acct-9');
        });

        it('should leave the accountId unset when no hint is provided', () => {
            const provider = createProvider();
            provider.trackDeployment('/subscriptions/test-sub/providers/Microsoft.Resources/deployments/d1');

            expect(provider.getChildren()[0].subscription.accountId).to.be.undefined;
        });

        it('should target the configured cloud', () => {
            const provider = createProvider();
            provider.trackDeployment('/subscriptions/test-sub/providers/Microsoft.Resources/deployments/d1');

            expect(provider.getChildren()[0].subscription.environment.resourceManagerEndpointUrl)
                .to.equal(AzurePublicCloud.resourceManagerEndpointUrl);
        });

        it('should fire onDidChange when tracking', () => {
            const provider = createProvider();
            const onChange = mock.fn();
            provider.onDidChange(onChange);

            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1');

            expect(onChange.mock.callCount()).to.equal(1);
        });

        it('should track multiple deployments', () => {
            const provider = createProvider();

            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1');
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d2');

            expect(provider.getChildren()).to.have.length(2);
        });

        it('should remove deployments and abort their tracking when the owning account signs out', () => {
            const { executor } = createTestActionExecutor();
            const { vscode } = createMockVsCode();
            const accountProvider = createMockAccountDataProvider();
            const provider = new ArmDeploymentDataProvider(vscode, executor, mock.fn(() => createMockClient()) as never, new CredentialOptionsScope(), accountProvider);
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/removed', 'tenant', 'ACCOUNT-1');
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/kept', 'tenant', 'account-2');
            const removed = provider.getChildren()[0];

            accountProvider.removeAccountsEmitter.fire(['account-1']);

            expect(removed.abortController.signal.aborted).to.be.true;
            expect(provider.getChildren().map(activity => activity.subscription.accountId)).to.deep.equal(['account-2']);
        });
    });

    describe('getChildren', () => {
        it('should return empty array when deployment has no operations', () => {
            const provider = createProvider();
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1');

            const root = provider.getChildren()[0];
            const children = provider.getChildren(root);
            expect(children).to.deep.equal([]);
        });
    });

    describe('enrich', () => {
        it('should fetch operations and store them on the deployment', async () => {
            const mockClient = createMockClient([
                { operationId: 'op1', targetId: '/subs/sub/rg/rg1/providers/Microsoft.Storage/storageAccounts/sa1', targetType: 'Microsoft.Storage/storageAccounts', targetName: 'sa1' },
            ]);
            const provider = createProvider(mockClient);
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1');

            const activity = provider.getChildren()[0];
            const changed = await provider.enrich(activity);

            expect(changed).to.be.true;
            expect(activity.operations).to.have.length(1);
            expect(activity.operations![0].targetResourceName).to.equal('sa1');
        });

        it('should build the deployment client for the deployment target', async () => {
            const { executor } = createTestActionExecutor();
            const { vscode } = createMockVsCode();
            const createClient = mock.fn((_target: AzureSubscriptionTarget) => createMockClient());
            const provider = new ArmDeploymentDataProvider(vscode, executor, createClient as never, new CredentialOptionsScope(), createMockAccountDataProvider());
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1', 'tenant-9', 'acct-9');

            await provider.enrich(provider.getChildren()[0]);

            expect(createClient.mock.callCount()).to.equal(1);
            const target = createClient.mock.calls[0].arguments[0];
            expect(target.subscriptionId).to.equal('sub');
            expect(target.tenantId).to.equal('tenant-9');
            expect(target.accountId).to.equal('acct-9');
        });

        it('should build the deployment client under a silent credential scope', async () => {
            const { executor } = createTestActionExecutor();
            const { vscode } = createMockVsCode();
            const scope = new CredentialOptionsScope();
            let observed: CredentialFactoryOptions | undefined;
            const createClient = mock.fn(() => {
                observed = scope.current;
                return createMockClient();
            });
            const provider = new ArmDeploymentDataProvider(vscode, executor, createClient as never, scope, createMockAccountDataProvider());
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1');

            await provider.enrich(provider.getChildren()[0]);

            expect(observed?.sessionOptions?.silent).to.be.true;
        });

        it('should leave the deployment unenriched instead of throwing when the fetch fails', async () => {
            const failingClient = {
                deployments: { getAtScope: mock.fn(() => Promise.reject(new Error('Pagination failed with unexpected statusCode 401'))) },
                deploymentOperations: {
                    listAtScope() {
                        return (async function* () {
                            yield await Promise.reject(new Error('Pagination failed with unexpected statusCode 401'));
                        })();
                    },
                },
            };
            const provider = createProvider(failingClient);
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1');

            // The tree turns a rejected enrichment into an error notification,
            // for work the user never asked for.
            const changed = await provider.enrich(provider.getChildren()[0]);

            expect(changed).to.be.false;
        });

        it('should create a client for each enrichment', async () => {
            const { executor } = createTestActionExecutor();
            const { vscode } = createMockVsCode();
            const client = createMockClient();
            const createClient = mock.fn(() => client);
            const provider = new ArmDeploymentDataProvider(vscode, executor, createClient as never, new CredentialOptionsScope(), createMockAccountDataProvider());
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1');
            const activity = provider.getChildren()[0];

            await provider.enrich(activity);
            await provider.enrich(activity);

            expect(createClient.mock.callCount()).to.equal(2);
        });

        it('should return false if the deployment was aborted', async () => {
            const provider = createProvider();
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1');

            const activity = provider.getChildren()[0];
            activity.abortController.abort();

            const changed = await provider.enrich(activity);
            expect(changed).to.be.false;
        });

        it('should stop polling once the deployment reaches a terminal state', async () => {
            const client = createMockClient([], ['Running', 'Succeeded']);
            const provider = createProvider(client);
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1');
            const activity = provider.getChildren()[0];
            const completed = waitForCompletedStatus(provider, activity);

            await provider.enrich(activity);
            await completed;

            expect(client.deployments.getAtScope.mock.callCount()).to.equal(2);
            expect(activity.endTime).to.be.instanceOf(Date);
        });

        describe('poll timing', () => {
            beforeEach(() => {
                mock.timers.enable({ apis: ['setTimeout'] });
            });

            afterEach(() => {
                mock.timers.reset();
            });

            it('should wait the server-provided retry-after interval between polls', async () => {
                // The first poll response sets the pace, so the wait before the
                // final poll is the 1s retry-after rather than the 10s default.
                const client = createMockClient([], ['Running', 'Running', 'Succeeded'], '1');
                const provider = createProvider(client);
                provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1');
                const activity = provider.getChildren()[0];
                const completed = waitForCompletedStatus(provider, activity);

                await provider.enrich(activity);
                await waitFor(() => client.deployments.getAtScope.mock.callCount() === 2, 'the initial deployment polls');
                expect(client.deployments.getAtScope.mock.callCount()).to.equal(2);

                mock.timers.tick(999);
                expect(client.deployments.getAtScope.mock.callCount()).to.equal(2);

                mock.timers.tick(1);
                await completed;
                expect(client.deployments.getAtScope.mock.callCount()).to.equal(3);
            });

            it('should keep polling after a transient request failure', async () => {
                const client = createMockClient([], ['Running', 'Running', 'Succeeded'], '1', 2);
                const provider = createProvider(client);
                provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1');
                const activity = provider.getChildren()[0];
                const completed = waitForCompletedStatus(provider, activity);

                await provider.enrich(activity);
                await waitFor(() => client.deployments.getAtScope.mock.callCount() === 2, 'the initial deployment polls');
                expect(client.deployments.getAtScope.mock.callCount()).to.equal(2);

                mock.timers.tick(1000);
                await waitFor(() => client.deployments.getAtScope.mock.callCount() === 3, 'the transient deployment poll');
                expect(client.deployments.getAtScope.mock.callCount()).to.equal(3);

                mock.timers.tick(1000);
                await completed;
                expect(activity.status).to.equal('Completed');
                expect(client.deployments.getAtScope.mock.callCount()).to.equal(4);
            });
        });

        it('should deduplicate operations by target resource ID, keeping highest rank', async () => {
            const mockClient = createMockClient([
                { operationId: 'op1', targetId: '/res/sa1', targetType: 'Microsoft.Storage/storageAccounts', targetName: 'sa1', provisioningOperation: 'Read' },
                { operationId: 'op2', targetId: '/res/sa1', targetType: 'Microsoft.Storage/storageAccounts', targetName: 'sa1', provisioningOperation: 'Create' },
            ]);
            const provider = createProvider(mockClient);
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1');

            const activity = provider.getChildren()[0];
            await provider.enrich(activity);

            expect(activity.operations).to.have.length(1);
            expect(activity.operations![0].operationId).to.equal('op2');
        });

        it('should skip operations without operationId or target resource ID', async () => {
            const mockClient = {
                deployments: { getAtScope: mock.fn(() => Promise.resolve({ id: 'x', name: 'x', type: 'x', properties: {} })) },
                deploymentOperations: {
                    listAtScope() {
                        // eslint-disable-next-line @typescript-eslint/require-await
                        return (async function* () {
                            yield {
                                items: [
                                    { operationId: undefined, properties: { targetResource: { id: '/res/1' } } },
                                    { operationId: 'op1', properties: { targetResource: undefined } },
                                    { operationId: 'op2', properties: { targetResource: { id: '/res/2', resourceType: 'Microsoft.Web/sites', resourceName: 'site1' }, provisioningOperation: 'Create', provisioningState: 'Succeeded' } },
                                ],
                                hasMore: false,
                            };
                        })();
                    },
                },
            };
            const provider = createProvider(mockClient);
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1');

            const activity = provider.getChildren()[0];
            await provider.enrich(activity);

            expect(activity.operations).to.have.length(1);
            expect(activity.operations![0].targetResourceName).to.equal('site1');
        });

        it('should extract child deployments from nested deployment operations', async () => {
            const nestedId = '/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.Resources/deployments/nested1';
            const mockClient = createMockClient([
                { operationId: 'op1', targetId: nestedId, targetType: 'Microsoft.Resources/deployments', targetName: 'nested1', provisioningState: 'Running' },
                { operationId: 'op2', targetId: '/subs/sub/rg/rg1/providers/Microsoft.Storage/storageAccounts/sa1', targetType: 'Microsoft.Storage/storageAccounts', targetName: 'sa1' },
            ]);
            const provider = createProvider(mockClient);
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1');

            const root = provider.getChildren()[0];
            await provider.enrich(root);

            // getChildren on the root should return the nested deployment
            const childDeployments = provider.getChildren(root);
            expect(childDeployments).to.have.length(1);
            expect(childDeployments[0].deploymentName).to.equal('nested1');
            expect(childDeployments[0].rootDeploymentId).to.equal(root.id);
        });

        it('should reuse existing child deployment objects for reference stability', async () => {
            const nestedId = '/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.Resources/deployments/nested1';
            const mockClient = createMockClient([
                { operationId: 'op1', targetId: nestedId, targetType: 'Microsoft.Resources/deployments', targetName: 'nested1' },
            ]);
            const provider = createProvider(mockClient);
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1');

            const root = provider.getChildren()[0];
            await provider.enrich(root);

            const firstChildren = provider.getChildren(root);
            const firstChild = firstChildren[0];

            // Enrich again (simulating a poll cycle)
            await provider.enrich(root);
            const secondChildren = provider.getChildren(root);

            // Same object reference should be reused
            expect(secondChildren[0]).to.equal(firstChild);
        });
    });

    describe('clearActivities', () => {
        it('should remove deployments matching the filter', () => {
            const provider = createProvider();

            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1');
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d2');

            provider.clearActivities(a => a.deploymentName === 'd1');

            const roots = provider.getChildren();
            expect(roots).to.have.length(1);
            expect(roots[0].deploymentName).to.equal('d2');
        });

        it('should abort the deployment controller on clear', () => {
            const provider = createProvider();
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1');

            const activity = provider.getChildren()[0];
            expect(activity.abortController.signal.aborted).to.be.false;

            provider.clearActivities(() => true);
            expect(activity.abortController.signal.aborted).to.be.true;
        });

        it('should not fire onDidChange when no activities match', () => {
            const provider = createProvider();
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1');

            const onChange = mock.fn();
            provider.onDidChange(onChange);

            provider.clearActivities(() => false);
            expect(onChange.mock.callCount()).to.equal(0);
        });
    });

    describe('dispose', () => {
        it('should abort all tracked deployments', () => {
            const provider = createProvider();
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1');

            const activity = provider.getChildren()[0];
            provider.dispose();

            expect(activity.abortController.signal.aborted).to.be.true;
        });
    });
});
