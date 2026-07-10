/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { mock } from 'node:test';
import { ClearActivities } from '../../../src/commands/deploy/ClearActivities';
import { CodeDeploymentDataProvider } from '../../../src/tree/activity/CodeDeploymentDataProvider';
import { GenericActivityDataProvider } from '../../../src/tree/activity/GenericActivityDataProvider';

describe('ClearActivities (unit)', () => {
    function createProviders() {
        const generic = new GenericActivityDataProvider();
        const code = new CodeDeploymentDataProvider();
        // Minimal ARM provider mock -- just needs clearActivities
        const arm = { clearActivities: mock.fn() };
        return { generic, code, arm };
    }

    it('should clear all activities in all mode', async () => {
        const { generic, code, arm } = createProviders();

        generic.trackActivity({ status: 'InProgress', title: 'Running' });
        generic.trackActivity({ status: 'Completed', title: 'Done' });
        code.trackDeployment({ title: 'Failed deploy', status: 'Failed' });

        const cmd = new ClearActivities(arm as never, code, generic);
        cmd.execute('all');

        expect(await generic.getChildren()).to.have.length(0);
        expect(await code.getChildren()).to.have.length(0);
        expect(arm.clearActivities.mock.callCount()).to.equal(1);
    });

    it('should clear only completed activities in completed mode', async () => {
        const { generic, code, arm } = createProviders();

        generic.trackActivity({ status: 'Completed', title: 'Done' });
        const running = generic.trackActivity({ status: 'InProgress', title: 'Running' });
        generic.trackActivity({ status: 'Failed', title: 'Errored' });

        const cmd = new ClearActivities(arm as never, code, generic);
        cmd.execute('completed');

        const remaining = await generic.getChildren();
        expect(remaining).to.have.length(1);
        expect(remaining[0].id).to.equal(running.id);
    });

    it('should clear only successful activities in successful mode', async () => {
        const { generic, code, arm } = createProviders();

        generic.trackActivity({ status: 'Completed', title: 'Success' });
        const failed = generic.trackActivity({ status: 'Failed', title: 'Fail' });
        const running = generic.trackActivity({ status: 'InProgress', title: 'Running' });

        const cmd = new ClearActivities(arm as never, code, generic);
        cmd.execute('successful');

        const remaining = await generic.getChildren();
        expect(remaining).to.have.length(2);
        expect(remaining.map(r => r.id)).to.include(failed.id);
        expect(remaining.map(r => r.id)).to.include(running.id);
    });
});
