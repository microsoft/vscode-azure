/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * UI tests for the Azure Resources tree, driven against the deterministic mock
 * data defined in `test/override/mock.ts` (`AZURE_MOCK_DATA=1`). Every label
 * asserted here comes from that file, so changing the mock data intentionally
 * shows up as an obvious failure.
 */

import { activityViewName, resourcesViewName } from './fixtures/workbench';
import { expect, test } from './fixtures/vscodeApp';

test.describe('Azure Resources tree (ui)', () => {
    test('renders the mock subscription', async ({ wb }) => {
        await wb.focusView(resourcesViewName);

        await expect(wb.treeItem('Mock Subscription')).toBeVisible();
    });

    test('expands a subscription to its resource groups', async ({ wb }) => {
        await wb.focusView(resourcesViewName);
        await wb.expandTreeItem('Mock Subscription');

        await expect(wb.treeItem('demo-rg')).toBeVisible();
        await expect(wb.treeItem('staging-rg')).toBeVisible();
    });

    test('expands a resource group to its resources', async ({ wb }) => {
        await wb.focusView(resourcesViewName);
        await wb.expandTreeItem('Mock Subscription');
        await wb.expandTreeItem('demo-rg');

        await expect(wb.treeItem('myDemoRegistry')).toBeVisible();
        await expect(wb.treeItem('demo-webapp')).toBeVisible();
        await expect(wb.treeItem('demostorage')).toBeVisible();
    });

    test('regroups the tree by resource type', async ({ wb }) => {
        await wb.focusView(resourcesViewName);
        await wb.expandTreeItem('Mock Subscription');
        await expect(wb.treeItem('demo-rg')).toBeVisible();

        await wb.runViewTitleAction(resourcesViewName, 'Group By');
        await wb.pickQuickInputItem('Resource Type');

        // Virtual group nodes are labeled with the resource's logical type.
        await expect(wb.treeItem('Microsoft.ContainerRegistry/registries')).toBeVisible();
        await expect(wb.treeItem('demo-rg')).toBeHidden();

        // Resource groups from both mock groups collapse into one type node.
        await wb.expandTreeItem('Microsoft.ContainerRegistry/registries');
        await expect(wb.treeItem('myDemoRegistry')).toBeVisible();
        await expect(wb.treeItem('stagingReg')).toBeVisible();
    });

    test('lists the seeded activities in the activity view', async ({ wb }) => {
        await wb.focusView(activityViewName);

        await expect(wb.treeItem('Deployment succeeded')).toBeVisible();
        await expect(wb.treeItem('Deploy to staging')).toBeVisible();

        await wb.expandTreeItem('Deploy to staging');
        await expect(wb.treeItem('Upload artifacts')).toBeVisible();
    });
});
