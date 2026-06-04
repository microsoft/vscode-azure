/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { mock } from 'node:test';
import { GenericActivityDataProvider } from '../../../tree/activity/GenericActivityDataProvider';
import { makeActivity } from './mockActivity';

describe('GenericActivityDataProvider (unit)', () => {
    it('should track an activity and return it from getChildren', async () => {
        const provider = new GenericActivityDataProvider();
        provider.trackActivity({ id: 'a1', status: 'InProgress', title: 'Test' });

        const children = await provider.getChildren();
        expect(children).to.have.length(1);
        expect(children[0].id).to.equal('a1');
        expect(children[0].type).to.equal('generic');
    });

    it('should return no children for a leaf activity', async () => {
        const provider = new GenericActivityDataProvider();
        const activity = provider.trackActivity({ id: 'a1', status: 'InProgress', title: 'Test' });

        const children = await provider.getChildren(activity);
        expect(children).to.deep.equal([]);
    });

    it('should fire onDidChange when tracking an activity', () => {
        const provider = new GenericActivityDataProvider();
        const onChange = mock.fn();
        provider.onDidChange(onChange);

        provider.trackActivity({ id: 'a1', status: 'InProgress', title: 'Test' });

        expect(onChange.mock.callCount()).to.equal(1);
    });

    it('should update an existing activity', () => {
        const provider = new GenericActivityDataProvider();
        const activity = provider.trackActivity({ id: 'a1', status: 'InProgress', title: 'Test' });

        provider.updateActivity('a1', { status: 'Completed', title: 'Done' });

        expect(activity.status).to.equal('Completed');
        expect(activity.title).to.equal('Done');
    });

    it('should fire onDidChange when updating an activity', () => {
        const provider = new GenericActivityDataProvider();
        provider.trackActivity({ id: 'a1', status: 'InProgress', title: 'Test' });

        const onChange = mock.fn();
        provider.onDidChange(onChange);

        provider.updateActivity('a1', { status: 'Failed' });
        expect(onChange.mock.callCount()).to.equal(1);
    });

    it('should clear activities matching the filter', async () => {
        const provider = new GenericActivityDataProvider();
        provider.trackActivity({ id: 'a1', status: 'Completed', title: 'Done' });
        provider.trackActivity({ id: 'a2', status: 'InProgress', title: 'Running' });

        provider.clearActivities(a => a.status === 'Completed');

        const children = await provider.getChildren();
        expect(children).to.have.length(1);
        expect(children[0].id).to.equal('a2');
    });

    it('should not fire onDidChange when no activities match the filter', () => {
        const provider = new GenericActivityDataProvider();
        provider.trackActivity({ id: 'a1', status: 'InProgress', title: 'Running' });

        const onChange = mock.fn();
        provider.onDidChange(onChange);

        provider.clearActivities(a => a.status === 'Completed');
        expect(onChange.mock.callCount()).to.equal(0);
    });

    it('should handle canHandle correctly', () => {
        const provider = new GenericActivityDataProvider();
        const activity = provider.trackActivity({ id: 'a1', status: 'InProgress', title: 'Test' });

        expect(provider.canHandle(activity)).to.be.true;
        expect(provider.canHandle(makeActivity({ type: 'armDeployment' }))).to.be.false;
        expect(provider.canHandle('string')).to.be.false;
    });
});
