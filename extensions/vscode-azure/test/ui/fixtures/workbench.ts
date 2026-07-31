/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Helpers for driving the VS Code workbench from a Playwright {@linkcode Page}.
 *
 * Interactions go through the Command Palette and role-based locators rather
 * than VS Code's internal CSS class names wherever possible, so the specs
 * survive workbench styling changes. The same helpers work against both the
 * Electron window and the browser-served workbench.
 */

import { expect, type Locator, type Page } from '@playwright/test';

/** Title of the Azure Resources tree view (`views.vscode-azure/resources` in `package.nls.json`). */
export const resourcesViewName = 'Resources';

/** Title of the Azure Activity Log tree view (`views.vscode-azure/activity` in `package.nls.json`). */
export const activityViewName = 'Activity Log';

/** Drives a VS Code workbench page. */
export class Workbench {
    public constructor(private readonly page: Page) { }

    /**
     * Waits until the extension has contributed its activity bar container,
     * which only happens after activation has registered the tree views.
     */
    public async waitForExtensionActivation(): Promise<void> {
        await expect(this.page.locator('.activitybar [aria-label*="Azure"]').first()).toBeVisible({ timeout: 120_000 });
    }

    /**
     * Runs a command by its Command Palette title (for example `Azure: Group By...`).
     *
     * Matching is by visible row text, so a partial title is enough as long as
     * it uniquely identifies the command.
     */
    public async runCommand(title: string): Promise<void> {
        await this.page.keyboard.press('F1');
        const input = this.page.locator('.quick-input-widget .quick-input-box input');
        await expect(input).toBeVisible();
        await input.fill(`>${title}`);
        await this.pickQuickInputItem(title);
    }

    /**
     * Selects the first Quick Pick row containing `label` and waits for the
     * Quick Pick to close.
     */
    public async pickQuickInputItem(label: string): Promise<void> {
        const row = this.page.locator('.quick-input-list .monaco-list-row').filter({ hasText: label }).first();
        await expect(row).toBeVisible();
        await row.click();
        await expect(this.page.locator('.quick-input-widget')).toBeHidden();
    }

    /** Reveals and focuses a tree view by its title, e.g. `Resources` or `Activity Log`. */
    public async focusView(viewName: string): Promise<void> {
        await this.runCommand(`Focus on ${viewName} View`);
    }

    /** The `.pane` element hosting the named tree view. */
    public viewPane(viewName: string): Locator {
        return this.page.locator('.pane').filter({
            has: this.page.getByRole('heading', { name: viewName, exact: true }),
        }).first();
    }

    /**
     * Clicks a view title-bar action (the icons that appear in a view's header
     * on hover), e.g. `Group By...` on the Resources view.
     *
     * Many of the extension's commands are hidden from the Command Palette
     * (`"when": "false"` in `menus.commandPalette`) precisely because they are
     * title actions, so this is the only way to invoke them from the UI.
     */
    public async runViewTitleAction(viewName: string, actionLabel: string): Promise<void> {
        const header = this.viewPane(viewName).locator('.pane-header');
        await header.hover();

        const action = header.getByRole('button', { name: actionLabel });
        await expect(action).toBeVisible();
        await action.click();
    }

    /**
     * Locates a tree item by its visible label.
     *
     * Scoped to the whole workbench rather than a single view: view containers
     * are keyed by generated ids, and label collisions between the Azure views
     * do not occur with the mock data set.
     */
    public treeItem(label: string): Locator {
        return this.page.locator('.monaco-list-row[role="treeitem"]').filter({ hasText: label }).first();
    }

    /** Waits for a tree item with the given label to be visible, and returns it. */
    public async waitForTreeItem(label: string): Promise<Locator> {
        const item = this.treeItem(label);
        await expect(item).toBeVisible();
        return item;
    }

    /**
     * Expands a collapsible tree item and waits for the expansion to be
     * reflected in the accessibility state. No-op if it is already expanded.
     */
    public async expandTreeItem(label: string): Promise<void> {
        const item = await this.waitForTreeItem(label);

        if (await item.getAttribute('aria-expanded') === 'true') {
            return;
        }

        await item.click();
        // Clicking selects the row; ArrowRight expands it without toggling an
        // already-expanded row back closed.
        await this.page.keyboard.press('ArrowRight');
        await expect(item).toHaveAttribute('aria-expanded', 'true');
    }

    /** Labels of every currently rendered tree item, in visual order. */
    public async visibleTreeItemLabels(): Promise<string[]> {
        const labels = await this.page.locator('.monaco-list-row[role="treeitem"]').allInnerTexts();
        return labels.map(label => label.trim()).filter(label => label.length > 0);
    }
}
