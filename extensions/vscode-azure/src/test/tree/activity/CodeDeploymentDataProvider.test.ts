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
        provider.trackDeployment({ id: 'cd1', status: 'InProgress', title: 'Deploy' });

        const children = await provider.getChildren();
        expect(children).to.have.length(1);
        expect(children[0].id).to.equal('cd1');
        expect(children[0].type).to.equal('codeDeployment');
    });

    it('should return child deployments when present', async () => {
        const provider = new CodeDeploymentDataProvider();
        const parent = provider.trackDeployment({
            id: 'cd1',
            status: 'InProgress',
            title: 'Deploy',
            children: [
                { id: 'child1', type: 'codeDeployment', status: 'InProgress', title: 'Child', startTime: new Date() },
            ],
        });

        const children = await provider.getChildren(parent);
        expect(children).to.have.length(1);
        expect(children[0].id).to.equal('child1');
    });

    it('should fire onDidChange when tracking a deployment', () => {
        const provider = new CodeDeploymentDataProvider();
        const onChange = mock.fn();
        provider.onDidChange(onChange);

        provider.trackDeployment({ id: 'cd1', status: 'InProgress', title: 'Deploy' });
        expect(onChange.mock.callCount()).to.equal(1);
    });

    it('should clear deployments matching the filter', async () => {
        const provider = new CodeDeploymentDataProvider();
        provider.trackDeployment({ id: 'cd1', status: 'Completed', title: 'Done' });
        provider.trackDeployment({ id: 'cd2', status: 'InProgress', title: 'Running' });

        provider.clearActivities(a => a.status === 'Completed');

        const children = await provider.getChildren();
        expect(children).to.have.length(1);
        expect(children[0].id).to.equal('cd2');
    });

    it('should handle canHandle correctly', () => {
        const provider = new CodeDeploymentDataProvider();
        const deployment = provider.trackDeployment({ id: 'cd1', status: 'InProgress', title: 'Test' });

        expect(provider.canHandle(deployment)).to.be.true;
        expect(provider.canHandle(makeActivity())).to.be.false;
    });
});
