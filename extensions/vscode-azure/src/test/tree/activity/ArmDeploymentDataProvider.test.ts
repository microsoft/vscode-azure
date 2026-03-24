/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { ActionExecutor } from '@microsoft/vscode-azure-utils';
import { NullTelemetryReporter } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import { ArmDeploymentDataProvider, parseDeploymentId } from '../../../tree/activity/ArmDeploymentDataProvider';
import { makeActivity } from './mockActivity';

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

describe('ArmDeploymentDataProvider (unit)', () => {
    function createProvider() {
        const executor = new ActionExecutor(new NullTelemetryReporter());
        const createClient = mock.fn(() => Promise.resolve({}));
        return new ArmDeploymentDataProvider(executor, createClient as never);
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
