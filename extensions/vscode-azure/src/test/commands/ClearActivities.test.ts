/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import { ClearActivities } from '../../commands/ClearActivities';
import { CodeDeploymentDataProvider } from '../../tree/activity/CodeDeploymentDataProvider';
import { GenericActivityDataProvider } from '../../tree/activity/GenericActivityDataProvider';

describe('ClearActivities (unit)', () => {
    function createProviders() {
        const generic = new GenericActivityDataProvider();
        const code = new CodeDeploymentDataProvider();
        // Minimal ARM provider mock — just needs clearActivities
        const arm = { clearActivities: mock.fn() };
        return { generic, code, arm };
    }

    it('should clear all activities in all mode', async () => {
        const { generic, code, arm } = createProviders();

        generic.trackActivity({ id: 'g1', status: 'InProgress', title: 'Running' });
        generic.trackActivity({ id: 'g2', status: 'Completed', title: 'Done' });
        code.trackDeployment({ id: 'c1', status: 'Failed', title: 'Failed deploy' });

        const cmd = new ClearActivities(arm as never, code, generic);
        cmd.execute('all');

        expect(await generic.getChildren()).to.have.length(0);
        expect(await code.getChildren()).to.have.length(0);
        expect(arm.clearActivities.mock.callCount()).to.equal(1);
    });

    it('should clear only completed activities in completed mode', async () => {
        const { generic, code, arm } = createProviders();

        generic.trackActivity({ id: 'g1', status: 'Completed', title: 'Done' });
        generic.trackActivity({ id: 'g2', status: 'InProgress', title: 'Running' });
        generic.trackActivity({ id: 'g3', status: 'Failed', title: 'Errored' });

        const cmd = new ClearActivities(arm as never, code, generic);
        cmd.execute('completed');

        const remaining = await generic.getChildren();
        expect(remaining).to.have.length(1);
        expect(remaining[0].id).to.equal('g2');
    });

    it('should clear only successful activities in successful mode', async () => {
        const { generic, code, arm } = createProviders();

        generic.trackActivity({ id: 'g1', status: 'Completed', title: 'Success' });
        generic.trackActivity({ id: 'g2', status: 'Failed', title: 'Fail' });
        generic.trackActivity({ id: 'g3', status: 'InProgress', title: 'Running' });

        const cmd = new ClearActivities(arm as never, code, generic);
        cmd.execute('successful');

        const remaining = await generic.getChildren();
        expect(remaining).to.have.length(2);
        expect(remaining.map(r => r.id)).to.include('g2');
        expect(remaining.map(r => r.id)).to.include('g3');
    });
});
