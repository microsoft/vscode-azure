/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import { CodeDeploymentDataProvider } from '../../../tree/activity/CodeDeploymentDataProvider';
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
        handle.addChild('Child');

        const roots = await provider.getChildren();
        const children = await provider.getChildren(roots[0]);
        expect(children).to.have.length(1);
        expect(children[0].title).to.equal('Child');
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
        const child1 = handle.addChild('Service A');
        const child2 = handle.addChild('Service B');

        child1.complete('Completed');
        child2.complete('Failed');

        const roots = await provider.getChildren();
        const children = await provider.getChildren(roots[0]);
        expect(children).to.have.length(2);
        expect(children[0].status).to.equal('Completed');
        expect(children[1].status).to.equal('Failed');
    });
});
