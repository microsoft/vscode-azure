/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as vscode from 'vscode';
import type { Activity } from '../../../tree/activity/Activity';
import { toActivityTreeItem } from '../../../tree/activity/ActivityViewProvider';
import { makeActivity } from './mockActivity';

describe('toActivityTreeItem (unit)', () => {
    it('should create a collapsed tree item for deployment activities', () => {
        const activity = makeActivity({ id: 'deploy-1', type: 'armDeployment', title: 'My Deployment', description: 'Running' });

        const item = toActivityTreeItem(vscode, activity, 'deploy-1');

        expect(item.label).to.equal('My Deployment');
        expect(item.description).to.equal('Running');
        expect(item.id).to.equal('deploy-1');
    });

    it('should create a non-collapsible tree item for leaf activities', () => {
        const activity = makeActivity({ id: 'op-1', type: 'armDeploymentOperation', status: 'Completed', title: 'Create resource' });

        const item = toActivityTreeItem(vscode, activity, 'op-1');

        expect(item.label).to.equal('Create resource');
    });

    it('should create a non-collapsible tree item for generic activities', () => {
        const activity = makeActivity({ id: 'gen-1', status: 'NotStarted', title: 'Generic task' });

        const item = toActivityTreeItem(vscode, activity, 'gen-1');

        expect(item.label).to.equal('Generic task');
    });

    it('should set icon based on status', () => {
        const statuses: Activity['status'][] = ['NotStarted', 'InProgress', 'Completed', 'Canceled', 'Failed'];

        for (const status of statuses) {
            const activity = makeActivity({ id: `test-${status}`, status, title: status });

            const item = toActivityTreeItem(vscode, activity, activity.id);
            expect(item.iconPath).to.not.be.undefined;
        }
    });
});
