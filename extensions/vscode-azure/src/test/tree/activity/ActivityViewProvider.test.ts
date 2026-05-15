/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as vscode from 'vscode';
import type { Activity } from '../../../tree/activity/Activity';
import { ActivityViewProvider, toActivityTreeItem } from '../../../tree/activity/ActivityViewProvider';
import { makeActivity } from './mockActivity';

describe('ActivityViewProvider (unit)', () => {
    function createProvider(activities: Activity[] = []) {
        const { vscode: code } = createMockVsCode();
        const activityMap = new Map(activities.map(a => [a.id, a]));
        const dataTree = {
            get: (id: string) => activityMap.get(id),
            getChildren: (parent?: Activity) => {
                if (!parent) {
                    return Promise.resolve(activities);
                }
                return Promise.resolve([]);
            },
        };
        return new ActivityViewProvider(code, dataTree as never);
    }

    describe('canHandle', () => {
        it('should return true for any string', () => {
            const provider = createProvider();
            expect(provider.canHandle('any-id')).to.be.true;
        });

        it('should return false for non-string values', () => {
            const provider = createProvider();
            expect(provider.canHandle(42)).to.be.false;
            expect(provider.canHandle(null)).to.be.false;
        });
    });

    describe('getChildren', () => {
        it('should return all activity IDs when called with no argument', async () => {
            const a1 = makeActivity({ id: 'a1' });
            const a2 = makeActivity({ id: 'a2' });
            const provider = createProvider([a1, a2]);

            const children = await provider.getChildren();
            expect(children).to.deep.equal(['a1', 'a2']);
        });

        it('should return child IDs for a known activity', async () => {
            const child = makeActivity({ id: 'child-1' });
            const parent = makeActivity({ id: 'parent-1' });
            const childMap = new Map([[parent.id, [child]]]);

            const { vscode: code } = createMockVsCode();
            const activityMap = new Map([[parent.id, parent], [child.id, child]]);
            const dataTree = {
                get: (id: string) => activityMap.get(id),
                getChildren: (p?: Activity) => Promise.resolve(p ? (childMap.get(p.id) ?? []) : [parent]),
            };
            const provider = new ActivityViewProvider(code, dataTree as never);

            const children = await provider.getChildren('parent-1');
            expect(children).to.deep.equal(['child-1']);
        });

        it('should throw for an unknown activity ID', async () => {
            const provider = createProvider();
            try {
                await provider.getChildren('unknown');
                expect.fail('should have thrown');
            } catch (e) {
                expect((e as Error).message).to.include('not found');
            }
        });
    });

    describe('getTreeItem', () => {
        it('should return a tree item for a known activity', () => {
            const activity = makeActivity({ id: 'a1', title: 'My Task' });
            const provider = createProvider([activity]);

            const item = provider.getTreeItem('a1');
            expect(item.label).to.equal('My Task');
        });

        it('should throw for an unknown activity ID', () => {
            const provider = createProvider();
            expect(() => provider.getTreeItem('unknown')).to.throw('not found');
        });
    });
});

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

    it('should collapse code deployment activities', () => {
        const activity = makeActivity({ id: 'cd-1', type: 'codeDeployment', title: 'Code Deploy' });

        const item = toActivityTreeItem(vscode, activity, 'cd-1');
        expect(item.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.Collapsed);
    });

    it('should set icon based on status', () => {
        const statuses: Activity['status'][] = ['NotStarted', 'InProgress', 'Completed', 'Canceled', 'Failed', 'Info', 'Warn'];

        for (const status of statuses) {
            const activity = makeActivity({ id: `test-${status}`, status, title: status });

            const item = toActivityTreeItem(vscode, activity, activity.id);
            expect(item.iconPath).to.not.be.undefined;
        }
    });
});
