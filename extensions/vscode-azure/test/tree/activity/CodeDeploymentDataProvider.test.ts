/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { mock } from 'node:test';
import * as util from 'node:util';
import { CodeDeploymentDataProvider } from '../../../src/tree/activity/CodeDeploymentDataProvider';
import { makeActivity } from './mockActivity';

describe('CodeDeploymentDataProvider (unit)', () => {
    it('should track a deployment and return it from getChildren', async () => {
        const provider = new CodeDeploymentDataProvider();
        provider.trackDeployment({ title: 'Deploy' });

        const children = await provider.getChildren();
        expect(children).to.have.length(1);
        expect(children[0].type).to.equal('codeDeployment');
        expect(children[0].status).to.equal('InProgress');
    });

    it('should return child deployments added via handle', async () => {
        const provider = new CodeDeploymentDataProvider();
        const handle = provider.trackDeployment({ title: 'Deploy' });
        handle.addChild({ title: 'Child' });

        const roots = await provider.getChildren();
        const children = await provider.getChildren(roots[0]);
        expect(children).to.have.length(1);
        expect(children[0].title).to.equal('Child');
        expect(children[0].status).to.equal('Completed');
    });

    it('should default addChild to Completed with an endTime', async () => {
        const provider = new CodeDeploymentDataProvider();
        const handle = provider.trackDeployment({ title: 'Deploy' });
        handle.addChild({ title: 'Step 1' });

        const roots = await provider.getChildren();
        const children = await provider.getChildren(roots[0]);
        expect(children[0].status).to.equal('Completed');
        expect(children[0].endTime).to.be.instanceOf(Date);
    });

    it('should allow overriding addChild status', async () => {
        const provider = new CodeDeploymentDataProvider();
        const handle = provider.trackDeployment({ title: 'Deploy' });
        handle.addChild({ title: 'Pending Step', status: 'InProgress' });

        const roots = await provider.getChildren();
        const children = await provider.getChildren(roots[0]);
        expect(children[0].status).to.equal('InProgress');
        expect(children[0].endTime).to.be.undefined;
    });

    it('should fire onDidChange when tracking a deployment', () => {
        const provider = new CodeDeploymentDataProvider();
        const onChange = mock.fn();
        provider.onDidChange(onChange);

        provider.trackDeployment({ title: 'Deploy' });
        expect(onChange.mock.callCount()).to.equal(1);
    });

    it('should clear deployments matching the filter', async () => {
        const provider = new CodeDeploymentDataProvider();
        provider.trackDeployment({ title: 'Done', status: 'Completed' });
        provider.trackDeployment({ title: 'Running' });

        provider.clearActivities(a => a.status === 'Completed');

        const children = await provider.getChildren();
        expect(children).to.have.length(1);
        expect(children[0].status).to.equal('InProgress');
    });

    it('should handle canHandle correctly', async () => {
        const provider = new CodeDeploymentDataProvider();
        provider.trackDeployment({ title: 'Test' });

        const children = await provider.getChildren();
        expect(provider.canHandle(children[0])).to.be.true;
        expect(provider.canHandle(makeActivity())).to.be.false;
    });

    it('should complete a deployment via handle', async () => {
        const provider = new CodeDeploymentDataProvider();
        const handle = provider.trackDeployment({ title: 'Deploy' });

        handle.complete('Completed');

        const children = await provider.getChildren();
        expect(children[0].status).to.equal('Completed');
        expect(children[0].endTime).to.be.instanceOf(Date);
    });

    it('should add an error child when completing with an error', async () => {
        const provider = new CodeDeploymentDataProvider();
        const handle = provider.trackDeployment({ title: 'Deploy' });

        handle.complete('Failed', new Error('something broke'));

        const roots = await provider.getChildren();
        expect(roots[0].status).to.equal('Failed');
        const children = await provider.getChildren(roots[0]);
        expect(children).to.have.length(1);
        expect(children[0].title).to.equal('something broke');
        expect(children[0].status).to.equal('Failed');
    });

    it('should allow individually controlling child statuses', async () => {
        const provider = new CodeDeploymentDataProvider();
        const handle = provider.trackDeployment({ title: 'Deploy' });
        const child1 = handle.addChild({ title: 'Service A', status: 'InProgress' });
        const child2 = handle.addChild({ title: 'Service B', status: 'InProgress' });

        child1.complete('Completed');
        child2.complete('Failed');

        const roots = await provider.getChildren();
        const children = await provider.getChildren(roots[0]);
        expect(children).to.have.length(2);
        expect(children[0].status).to.equal('Completed');
        expect(children[1].status).to.equal('Failed');
    });

    it('should auto-complete pending children with parent status', async () => {
        const provider = new CodeDeploymentDataProvider();
        const handle = provider.trackDeployment({ title: 'Deploy' });
        handle.addChild({ title: 'Step 1', status: 'InProgress' });
        handle.addChild({ title: 'Step 2', status: 'NotStarted' });

        handle.complete('Completed');

        const roots = await provider.getChildren();
        const children = await provider.getChildren(roots[0]);
        expect(children).to.have.length(2);
        expect(children[0].status).to.equal('Completed');
        expect(children[0].endTime).to.be.instanceOf(Date);
        expect(children[1].status).to.equal('Completed');
        expect(children[1].endTime).to.be.instanceOf(Date);
    });

    it('should not alter already-finished children when parent completes', async () => {
        const provider = new CodeDeploymentDataProvider();
        const handle = provider.trackDeployment({ title: 'Deploy' });
        const child1 = handle.addChild({ title: 'Service A', status: 'InProgress' });
        handle.addChild({ title: 'Service B', status: 'InProgress' });

        child1.complete('Failed');
        handle.complete('Completed');

        const roots = await provider.getChildren();
        const children = await provider.getChildren(roots[0]);
        expect(children).to.have.length(2);
        expect(children[0].status).to.equal('Failed');
        expect(children[1].status).to.equal('Completed');
    });

    it('should not alter children already in Completed state when parent fails', async () => {
        const provider = new CodeDeploymentDataProvider();
        const handle = provider.trackDeployment({ title: 'Deploy' });
        handle.addChild({ title: 'Done Step' }); // defaults to Completed
        handle.addChild({ title: 'Pending Step', status: 'InProgress' });

        handle.complete('Failed');

        const roots = await provider.getChildren();
        const children = await provider.getChildren(roots[0]);
        expect(children).to.have.length(2);
        expect(children[0].status).to.equal('Completed');
        expect(children[1].status).to.equal('Failed');
    });

    it('should fire onDidChange when adding a child', () => {
        const provider = new CodeDeploymentDataProvider();
        const handle = provider.trackDeployment({ title: 'Deploy' });

        const onChange = mock.fn();
        provider.onDidChange(onChange);

        handle.addChild({ title: 'Step' });
        expect(onChange.mock.callCount()).to.equal(1);
    });

    it('should fire onDidChange when completing', () => {
        const provider = new CodeDeploymentDataProvider();
        const handle = provider.trackDeployment({ title: 'Deploy' });

        const onChange = mock.fn();
        provider.onDidChange(onChange);

        handle.complete('Completed');
        expect(onChange.mock.callCount()).to.equal(1);
    });

    it('should stringify non-Error values when completing with an error', async () => {
        const provider = new CodeDeploymentDataProvider();
        const handle = provider.trackDeployment({ title: 'Deploy' });

        handle.complete('Failed', { code: 'ETIMEDOUT' });

        const roots = await provider.getChildren();
        const children = await provider.getChildren(roots[0]);
        expect(children).to.have.length(1);
        expect(children[0].title).to.equal(util.inspect({ code: 'ETIMEDOUT' }));
        expect(children[0].status).to.equal('Failed');
    });

    it('should support nested grandchildren via child handle', async () => {
        const provider = new CodeDeploymentDataProvider();
        const handle = provider.trackDeployment({ title: 'Deploy' });
        const childHandle = handle.addChild({ title: 'Service A', status: 'InProgress' });
        childHandle.addChild({ title: 'Sub-step 1' });

        const roots = await provider.getChildren();
        const children = await provider.getChildren(roots[0]);
        const grandchildren = await provider.getChildren(children[0]);
        expect(grandchildren).to.have.length(1);
        expect(grandchildren[0].title).to.equal('Sub-step 1');
        expect(grandchildren[0].status).to.equal('Completed');
    });

    it('should expose the activity ID on the handle', () => {
        const provider = new CodeDeploymentDataProvider();
        const handle = provider.trackDeployment({ title: 'Deploy' });
        expect(handle.id).to.be.a('string').and.not.be.empty;
    });

    it('should recursively auto-complete pending grandchildren', async () => {
        const provider = new CodeDeploymentDataProvider();
        const handle = provider.trackDeployment({ title: 'Deploy' });
        const childHandle = handle.addChild({ title: 'Service A', status: 'InProgress' });
        childHandle.addChild({ title: 'Sub-step 1', status: 'InProgress' });
        childHandle.addChild({ title: 'Sub-step 2', status: 'NotStarted' });

        handle.complete('Completed');

        const roots = await provider.getChildren();
        const children = await provider.getChildren(roots[0]);
        expect(children[0].status).to.equal('Completed');
        const grandchildren = await provider.getChildren(children[0]);
        expect(grandchildren).to.have.length(2);
        expect(grandchildren[0].status).to.equal('Completed');
        expect(grandchildren[0].endTime).to.be.instanceOf(Date);
        expect(grandchildren[1].status).to.equal('Completed');
        expect(grandchildren[1].endTime).to.be.instanceOf(Date);
    });

    it('should not alter already-finished grandchildren during recursive completion', async () => {
        const provider = new CodeDeploymentDataProvider();
        const handle = provider.trackDeployment({ title: 'Deploy' });
        const childHandle = handle.addChild({ title: 'Service A', status: 'InProgress' });
        const grandchildHandle = childHandle.addChild({ title: 'Sub-step 1', status: 'InProgress' });
        childHandle.addChild({ title: 'Sub-step 2', status: 'InProgress' });

        grandchildHandle.complete('Failed');
        handle.complete('Completed');

        const roots = await provider.getChildren();
        const children = await provider.getChildren(roots[0]);
        const grandchildren = await provider.getChildren(children[0]);
        expect(grandchildren[0].status).to.equal('Failed');
        expect(grandchildren[1].status).to.equal('Completed');
    });

    it('should inherit status from immediate parent, not root', async () => {
        const provider = new CodeDeploymentDataProvider();
        const handle = provider.trackDeployment({ title: 'Deploy' });
        const childHandle = handle.addChild({ title: 'Service A', status: 'InProgress' });
        childHandle.addChild({ title: 'Sub-step', status: 'InProgress' });

        // Complete the child as Failed, then the root as Completed
        childHandle.complete('Failed');
        handle.complete('Completed');

        const roots = await provider.getChildren();
        const children = await provider.getChildren(roots[0]);
        // Service A was already Failed before root completed — untouched
        expect(children[0].status).to.equal('Failed');
        const grandchildren = await provider.getChildren(children[0]);
        // Sub-step inherited Failed from its immediate parent (Service A), not Completed from root
        expect(grandchildren[0].status).to.equal('Failed');
    });
});
