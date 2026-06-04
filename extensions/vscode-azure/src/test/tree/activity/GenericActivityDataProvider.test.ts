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
        const handle = provider.trackActivity({ status: 'InProgress', title: 'Test' });

        const children = await provider.getChildren();
        expect(children).to.have.length(1);
        expect(children[0].id).to.equal(handle.id);
        expect(children[0].type).to.equal('generic');
    });

    it('should return no children for a leaf activity', async () => {
        const provider = new GenericActivityDataProvider();
        provider.trackActivity({ status: 'InProgress', title: 'Test' });
        const [activity] = await provider.getChildren();

        const children = await provider.getChildren(activity);
        expect(children).to.deep.equal([]);
    });

    it('should fire onDidChange when tracking an activity', () => {
        const provider = new GenericActivityDataProvider();
        const onChange = mock.fn();
        provider.onDidChange(onChange);

        provider.trackActivity({ status: 'InProgress', title: 'Test' });

        expect(onChange.mock.callCount()).to.equal(1);
    });

    it('should default status to InProgress when not provided', async () => {
        const provider = new GenericActivityDataProvider();
        provider.trackActivity({ title: 'Test' });

        const [activity] = await provider.getChildren();
        expect(activity.status).to.equal('InProgress');
    });

    it('should assign a unique id to each tracked activity', () => {
        const provider = new GenericActivityDataProvider();
        const first = provider.trackActivity({ title: 'First' });
        const second = provider.trackActivity({ title: 'Second' });

        expect(first.id).to.be.a('string').and.not.equal('');
        expect(second.id).to.not.equal(first.id);
    });

    it('should update an existing activity via the handle', async () => {
        const provider = new GenericActivityDataProvider();
        const handle = provider.trackActivity({ status: 'InProgress', title: 'Test' });

        handle.update({ status: 'Completed', title: 'Done' });

        const [activity] = await provider.getChildren();
        expect(activity.status).to.equal('Completed');
        expect(activity.title).to.equal('Done');
    });

    it('should set endTime and error description when updating to a terminal status', async () => {
        const provider = new GenericActivityDataProvider();
        const handle = provider.trackActivity({ status: 'InProgress', title: 'Test' });

        handle.update({ status: 'Failed', error: new Error('boom') });

        const [activity] = await provider.getChildren();
        expect(activity.status).to.equal('Failed');
        expect(activity.description).to.equal('boom');
        expect(activity.endTime).to.be.an.instanceOf(Date);
    });

    it('should not set endTime when updating to a non-terminal status', async () => {
        const provider = new GenericActivityDataProvider();
        const handle = provider.trackActivity({ status: 'NotStarted', title: 'Test' });

        handle.update({ status: 'InProgress', title: 'Working' });

        const [activity] = await provider.getChildren();
        expect(activity.status).to.equal('InProgress');
        expect(activity.title).to.equal('Working');
        expect(activity.endTime).to.equal(undefined);
    });

    it('should apply final title/description in a single change event', async () => {
        const provider = new GenericActivityDataProvider();
        const handle = provider.trackActivity({ status: 'InProgress', title: 'Deleting...' });

        const onChange = mock.fn();
        provider.onDidChange(onChange);

        handle.update({ status: 'Completed', title: 'Deleted', description: 'done' });

        const [activity] = await provider.getChildren();
        expect(activity.status).to.equal('Completed');
        expect(activity.title).to.equal('Deleted');
        expect(activity.description).to.equal('done');
        expect(onChange.mock.callCount()).to.equal(1);
    });

    it('should prefer an explicit description over the error message', async () => {
        const provider = new GenericActivityDataProvider();
        const handle = provider.trackActivity({ status: 'InProgress', title: 'Test' });

        handle.update({ status: 'Failed', error: new Error('boom'), description: 'friendly message' });

        const [activity] = await provider.getChildren();
        expect(activity.description).to.equal('friendly message');
    });

    it('should allow transitioning between terminal statuses', async () => {
        const provider = new GenericActivityDataProvider();
        const handle = provider.trackActivity({ status: 'InProgress', title: 'Test' });
        handle.update({ status: 'Completed' });
        const [completed] = await provider.getChildren();
        const firstEndTime = completed.endTime;

        handle.update({ status: 'Failed' });

        const [failed] = await provider.getChildren();
        expect(failed.status).to.equal('Failed');
        expect(failed.endTime).to.be.an.instanceOf(Date);
        expect(failed.endTime).to.not.equal(firstEndTime);
    });

    it('should throw when moving from a terminal status to a non-terminal one', () => {
        const provider = new GenericActivityDataProvider();
        const handle = provider.trackActivity({ status: 'InProgress', title: 'Test' });
        handle.update({ status: 'Completed' });

        expect(() => { handle.update({ status: 'InProgress' }); }).to.throw(/terminal status/);
    });

    it('should fire onDidChange when updating an activity via the handle', () => {
        const provider = new GenericActivityDataProvider();
        const handle = provider.trackActivity({ status: 'InProgress', title: 'Test' });

        const onChange = mock.fn();
        provider.onDidChange(onChange);

        handle.update({ status: 'Failed' });
        expect(onChange.mock.callCount()).to.equal(1);
    });

    it('should clear activities matching the filter', async () => {
        const provider = new GenericActivityDataProvider();
        provider.trackActivity({ status: 'Completed', title: 'Done' });
        const running = provider.trackActivity({ status: 'InProgress', title: 'Running' });

        provider.clearActivities(a => a.status === 'Completed');

        const children = await provider.getChildren();
        expect(children).to.have.length(1);
        expect(children[0].id).to.equal(running.id);
    });

    it('should not fire onDidChange when no activities match the filter', () => {
        const provider = new GenericActivityDataProvider();
        provider.trackActivity({ status: 'InProgress', title: 'Running' });

        const onChange = mock.fn();
        provider.onDidChange(onChange);

        provider.clearActivities(a => a.status === 'Completed');
        expect(onChange.mock.callCount()).to.equal(0);
    });

    it('should handle canHandle correctly', async () => {
        const provider = new GenericActivityDataProvider();
        provider.trackActivity({ status: 'InProgress', title: 'Test' });
        const [activity] = await provider.getChildren();

        expect(provider.canHandle(activity)).to.be.true;
        expect(provider.canHandle(makeActivity({ type: 'armDeployment' }))).to.be.false;
        expect(provider.canHandle('string')).to.be.false;
    });
});
