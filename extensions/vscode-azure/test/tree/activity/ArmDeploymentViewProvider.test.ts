/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import type { ArmDeploymentActivity } from '../../../src/tree/activity/ArmDeploymentDataProvider';
import { ArmDeploymentViewProvider } from '../../../src/tree/activity/ArmDeploymentViewProvider';
import { makeArmDeploymentActivity, makeOperationActivity } from './mockActivity';

describe('ArmDeploymentViewProvider (unit)', () => {
    function createProvider(
        activities: ArmDeploymentActivity[] = [],
        childrenMap = new Map<string, ArmDeploymentActivity[]>(),
    ) {
        const { vscode: code } = createMockVsCode();
        const activityMap = new Map(activities.map(a => [a.id, a]));

        const dataTree = {
            get(id: string) { return activityMap.get(id); },
            getChildren(activity?: ArmDeploymentActivity) {
                if (!activity) {
                    return Promise.resolve(activities);
                }
                return Promise.resolve(childrenMap.get(activity.id) ?? []);
            },
        };

        return new ArmDeploymentViewProvider(code, dataTree as never);
    }

    describe('canHandle', () => {
        it('should return true for an armDeployment activity ID in the data tree', () => {
            const activity = makeArmDeploymentActivity();
            const provider = createProvider([activity]);

            expect(provider.canHandle(activity.id)).to.be.true;
        });

        it('should return true for an operation ID that belongs to a tracked deployment', () => {
            const op = makeOperationActivity();
            const activity = makeArmDeploymentActivity({ operations: [op] });
            const provider = createProvider([activity]);

            expect(provider.canHandle(op.id)).to.be.true;
        });

        it('should return false for an unknown activity ID', () => {
            const provider = createProvider();
            expect(provider.canHandle('unknown-id')).to.be.false;
        });

        it('should return false for non-string values', () => {
            const provider = createProvider();
            expect(provider.canHandle(42)).to.be.false;
            expect(provider.canHandle(null)).to.be.false;
        });

        it('should return false for a non-armDeployment activity type in the data tree', () => {
            const activity = makeArmDeploymentActivity({ type: 'generic' as never });
            const activityMap = new Map([[activity.id, activity]]);
            const { vscode: code } = createMockVsCode();
            const dataTree = {
                get(id: string) { return activityMap.get(id); },
                getChildren: () => Promise.resolve([]),
            };
            const provider = new ArmDeploymentViewProvider(code, dataTree as never);

            expect(provider.canHandle(activity.id)).to.be.false;
        });
    });

    describe('getChildren', () => {
        it('should return empty array when called with no argument', async () => {
            const provider = createProvider();
            const children = await provider.getChildren();
            expect(children).to.deep.equal([]);
        });

        it('should return empty array for a non-armDeployment activity', async () => {
            const provider = createProvider();
            const children = await provider.getChildren('unknown-id');
            expect(children).to.deep.equal([]);
        });

        it('should return child deployment IDs from the data tree', async () => {
            const nested = makeArmDeploymentActivity({
                id: '/subscriptions/sub/providers/Microsoft.Resources/deployments/nested1',
                deploymentName: 'nested1',
            });
            const root = makeArmDeploymentActivity();
            const childrenMap = new Map([[root.id, [nested]]]);
            const provider = createProvider([root, nested], childrenMap);

            const children = await provider.getChildren(root.id);
            expect(children).to.include(nested.id);
        });

        it('should inject visible leaf operations from enrichment', async () => {
            const op = makeOperationActivity();
            const root = makeArmDeploymentActivity({ operations: [op] });
            const provider = createProvider([root]);

            const children = await provider.getChildren(root.id);
            expect(children).to.include(op.id);
        });

        it('should exclude nested deployment operations from leaf operations', async () => {
            const nestedOp = makeOperationActivity({
                id: '/subscriptions/sub/providers/Microsoft.Resources/deployments/d1/operations/nested-op',
                targetResourceType: 'Microsoft.Resources/deployments',
                targetResourceName: 'nested1',
            });
            const leafOp = makeOperationActivity();
            const root = makeArmDeploymentActivity({ operations: [nestedOp, leafOp] });
            const provider = createProvider([root]);

            const children = await provider.getChildren(root.id);
            expect(children).to.not.include(nestedOp.id);
            expect(children).to.include(leafOp.id);
        });

        it('should exclude AVM telemetry operations', async () => {
            const avmOp = makeOperationActivity({
                id: '/subscriptions/sub/providers/Microsoft.Resources/deployments/d1/operations/avm-op',
                targetResourceType: 'Microsoft.Resources/deployments',
                targetResourceName: '46d3xTelemetryDeploy',
            });
            const root = makeArmDeploymentActivity({ operations: [avmOp] });
            const provider = createProvider([root]);

            const children = await provider.getChildren(root.id);
            expect(children).to.not.include(avmOp.id);
        });
    });

    describe('getTreeItem', () => {
        it('should return a tree item for a deployment activity', () => {
            const activity = makeArmDeploymentActivity({ title: 'My Deploy' });
            const provider = createProvider([activity]);

            const item = provider.getTreeItem(activity.id);
            expect(item.label).to.equal('My Deploy');
        });

        it('should return a tree item for an operation via its parent', () => {
            const op = makeOperationActivity({ title: 'Create storage' });
            const activity = makeArmDeploymentActivity({ operations: [op] });
            const provider = createProvider([activity]);

            const item = provider.getTreeItem(op.id);
            expect(item.label).to.equal('Create storage');
        });

        it('should throw for an unknown activity ID', () => {
            const provider = createProvider();
            expect(() => provider.getTreeItem('unknown-id')).to.throw('not found');
        });
    });
});
