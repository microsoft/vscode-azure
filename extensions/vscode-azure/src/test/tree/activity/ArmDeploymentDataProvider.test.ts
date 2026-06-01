/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import { ArmDeploymentDataProvider, isNestedDeploymentOp, isVisibleOperation, parseDeploymentId } from '../../../tree/activity/ArmDeploymentDataProvider';
import { makeActivity, makeOperationActivity } from './mockActivity';

/** Creates a mock IDeploymentClient that returns the given operations and deployment state. */
function createMockClient(
    operations: Array<{ operationId: string; targetId: string; targetType: string; targetName: string; provisioningOperation?: string; provisioningState?: string }> = [],
    deploymentState = 'Running',
) {
    return {
        deployments: {
            getAtScope: mock.fn((_scope: string, _name: string, options?: { onResponse?: (r: unknown) => void }) => {
                options?.onResponse?.({ headers: { get: () => null } });
                return Promise.resolve({
                    id: 'deploy-id',
                    name: 'deploy',
                    type: 'Microsoft.Resources/deployments',
                    properties: { provisioningState: deploymentState },
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
        return new ArmDeploymentDataProvider(vscode, executor, createClientFn as never);
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
            const subscription = makeSubscription();
            const deploymentId = '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Resources/deployments/myDeploy';

            provider.trackDeployment(deploymentId, subscription);

            const roots = provider.getChildren();
            expect(roots).to.have.length(1);
            expect(roots[0].deploymentName).to.equal('myDeploy');
            expect(roots[0].status).to.equal('InProgress');
            expect(roots[0].subscription).to.equal(subscription);
        });

        it('should populate scope from the deployment ID', () => {
            const provider = createProvider();
            provider.trackDeployment(
                '/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.Resources/deployments/d1',
                makeSubscription(),
            );

            const activity = provider.getChildren()[0];
            expect(activity.scope).to.equal('/subscriptions/sub/resourceGroups/rg1');
            expect(activity.rootDeploymentId).to.equal(activity.id);
        });

        it('should fire onDidChange when tracking', () => {
            const provider = createProvider();
            const onChange = mock.fn();
            provider.onDidChange(onChange);

            provider.trackDeployment(
                '/subscriptions/sub/providers/Microsoft.Resources/deployments/d1',
                makeSubscription(),
            );

            expect(onChange.mock.callCount()).to.equal(1);
        });

        it('should track multiple deployments', () => {
            const provider = createProvider();
            const sub = makeSubscription();

            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1', sub);
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d2', sub);

            expect(provider.getChildren()).to.have.length(2);
        });
    });

    describe('getChildren', () => {
        it('should return empty array when deployment has no operations', () => {
            const provider = createProvider();
            provider.trackDeployment(
                '/subscriptions/sub/providers/Microsoft.Resources/deployments/d1',
                makeSubscription(),
            );

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
            provider.trackDeployment(
                '/subscriptions/sub/providers/Microsoft.Resources/deployments/d1',
                makeSubscription(),
            );

            const activity = provider.getChildren()[0];
            const changed = await provider.enrich(activity);

            expect(changed).to.be.true;
            expect(activity.operations).to.have.length(1);
            expect(activity.operations![0].targetResourceName).to.equal('sa1');
        });

        it('should return false if the deployment was aborted', async () => {
            const provider = createProvider();
            provider.trackDeployment(
                '/subscriptions/sub/providers/Microsoft.Resources/deployments/d1',
                makeSubscription(),
            );

            const activity = provider.getChildren()[0];
            activity.abortController.abort();

            const changed = await provider.enrich(activity);
            expect(changed).to.be.false;
        });

        it('should deduplicate operations by target resource ID, keeping highest rank', async () => {
            const mockClient = createMockClient([
                { operationId: 'op1', targetId: '/res/sa1', targetType: 'Microsoft.Storage/storageAccounts', targetName: 'sa1', provisioningOperation: 'Read' },
                { operationId: 'op2', targetId: '/res/sa1', targetType: 'Microsoft.Storage/storageAccounts', targetName: 'sa1', provisioningOperation: 'Create' },
            ]);
            const provider = createProvider(mockClient);
            provider.trackDeployment(
                '/subscriptions/sub/providers/Microsoft.Resources/deployments/d1',
                makeSubscription(),
            );

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
            provider.trackDeployment(
                '/subscriptions/sub/providers/Microsoft.Resources/deployments/d1',
                makeSubscription(),
            );

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
            provider.trackDeployment(
                '/subscriptions/sub/providers/Microsoft.Resources/deployments/d1',
                makeSubscription(),
            );

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
            provider.trackDeployment(
                '/subscriptions/sub/providers/Microsoft.Resources/deployments/d1',
                makeSubscription(),
            );

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
            const sub = makeSubscription();

            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1', sub);
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d2', sub);

            provider.clearActivities(a => a.deploymentName === 'd1');

            const roots = provider.getChildren();
            expect(roots).to.have.length(1);
            expect(roots[0].deploymentName).to.equal('d2');
        });

        it('should abort the deployment controller on clear', () => {
            const provider = createProvider();
            provider.trackDeployment(
                '/subscriptions/sub/providers/Microsoft.Resources/deployments/d1',
                makeSubscription(),
            );

            const activity = provider.getChildren()[0];
            expect(activity.abortController.signal.aborted).to.be.false;

            provider.clearActivities(() => true);
            expect(activity.abortController.signal.aborted).to.be.true;
        });

        it('should not fire onDidChange when no activities match', () => {
            const provider = createProvider();
            provider.trackDeployment(
                '/subscriptions/sub/providers/Microsoft.Resources/deployments/d1',
                makeSubscription(),
            );

            const onChange = mock.fn();
            provider.onDidChange(onChange);

            provider.clearActivities(() => false);
            expect(onChange.mock.callCount()).to.equal(0);
        });
    });

    describe('dispose', () => {
        it('should abort all tracked deployments', () => {
            const provider = createProvider();
            const sub = makeSubscription();
            provider.trackDeployment('/subscriptions/sub/providers/Microsoft.Resources/deployments/d1', sub);

            const activity = provider.getChildren()[0];
            provider.dispose();

            expect(activity.abortController.signal.aborted).to.be.true;
        });
    });
});
