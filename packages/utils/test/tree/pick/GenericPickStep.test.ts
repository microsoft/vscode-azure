/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { GenericPickStep, type PickClassification } from '../../../src/tree/pick/GenericPickStep';
import type { PickContext } from '../../../src/tree/pick/PickContext';
import type { ITreeItem } from '../../../src/vscode/IVsCode';
import { Wizard } from '../../../src/wizard/Wizard';
import { MockOutputChannel } from '../../vscode/MockOutputChannel';
import { createMockCodeContext, respondToPrompts } from '../../vscode/MockVsCode';

function createTree(data: Record<string, string[]>, treeItems?: Record<string, ITreeItem>) {
    return {
        getChildren(key?: string): string[] {
            return data[key ?? ''] ?? [];
        },
        getTreeItem(key: string): ITreeItem {
            return treeItems?.[key] ?? { label: key, id: key };
        },
    };
}

function runPick(options: {
    tree: ReturnType<typeof createTree>;
    classify: (item: string, treeItem: ITreeItem) => PickClassification;
    canPickMany?: boolean;
    create?: { label: string; createNewItem: () => string | Promise<string> };
    title?: string;
    placeHolder?: string;
    stepName?: string;
    responses: Parameters<typeof respondToPrompts>[1];
}) {
    const { ctx, mock } = createMockCodeContext();
    const output = new MockOutputChannel('test');

    const tracker = respondToPrompts(mock, options.responses);

    const stepOptions: Record<string, unknown> = {
        ...ctx,
        tree: options.tree,
        classify: options.classify,
    };
    if (options.canPickMany) { stepOptions.canPickMany = true; }
    if (options.create) { stepOptions.create = options.create; }
    if (options.title) { stepOptions.title = options.title; }
    if (options.placeHolder) { stepOptions.placeHolder = options.placeHolder; }
    if (options.stepName) { stepOptions.stepName = options.stepName; }

    const wizard = new Wizard<PickContext<string>>(
        output,
        { picks: [] },
        [new GenericPickStep(stepOptions as never)],
    );

    return { promise: wizard.run(), tracker, mock };
}

describe('GenericPickStep (unit)', () => {
    it('should pick a terminal item', async () => {
        const tree = createTree({ '': ['alpha', 'beta'] });
        const { promise, tracker } = runPick({
            tree,
            classify: () => 'terminal',
            responses: [{ pick: 'alpha' }],
        });

        const result = await promise;
        expect(result.picks).to.have.length(1);
        expect(result.picks![0].item).to.equal('alpha');
        tracker.assertAllConsumed();
    });

    it('should filter out items classified as false', async () => {
        const tree = createTree({ '': ['visible', 'hidden'] });
        const { promise, tracker } = runPick({
            tree,
            classify: (item) => item === 'hidden' ? false : 'terminal',
            responses: [{ pick: 'visible' }],
        });

        const result = await promise;
        expect(result.picks).to.have.length(1);
        expect(result.picks![0].item).to.equal('visible');
        tracker.assertAllConsumed();
    });

    it('should filter out items with no label', async () => {
        const tree = createTree(
            { '': ['has-label', 'no-label'] },
            {
                'has-label': { label: 'Has Label', id: 'has-label' },
                'no-label': { label: '', id: 'no-label' },
            },
        );

        const { promise, tracker } = runPick({
            tree,
            classify: () => 'terminal',
            responses: [{ pick: 'Has Label' }],
        });

        const result = await promise;
        expect(result.picks).to.have.length(1);
        expect(result.picks![0].item).to.equal('has-label');
        tracker.assertAllConsumed();
    });

    it('should show description from tree items', async () => {
        const tree = createTree(
            { '': ['item-a'] },
            { 'item-a': { label: 'Item A', description: 'some detail', id: 'a' } },
        );

        const { promise, tracker, mock } = runPick({
            tree,
            classify: () => 'terminal',
            responses: [{ pick: 'Item A' }],
        });

        await promise;
        // The quick pick was created and should have the item with description
        expect(mock.quickPicks).to.have.length(1);
        const qpItems = mock.quickPicks[0].items;
        expect(qpItems).to.have.length(1);
        expect(qpItems[0].description).to.equal('some detail');
        tracker.assertAllConsumed();
    });

    it('should append chevron to intermediate items', async () => {
        const tree = createTree({ '': ['folder', 'leaf'] });
        const { promise, mock } = runPick({
            tree,
            classify: (item) => item === 'folder' ? 'intermediate' : 'terminal',
            responses: [{ pick: 'leaf' }],
        });

        await promise;
        const qpItems = mock.quickPicks[0].items;
        const folderItem = qpItems.find(i => i.label.includes('folder'));
        const leafItem = qpItems.find(i => i.label === 'leaf');
        expect(folderItem?.label).to.equal('folder $(chevron-right)');
        expect(leafItem?.label).to.equal('leaf');
    });

    it('should auto-skip a single skip-classified item', async () => {
        const tree = createTree({ '': ['only-one'] });
        const { promise } = runPick({
            tree,
            classify: () => 'skip',
            responses: [], // no prompt expected -- it auto-skips
        });

        const result = await promise;
        expect(result.picks).to.have.length(1);
        expect(result.picks![0].item).to.equal('only-one');
    });

    it('should NOT auto-skip a single terminal item', async () => {
        const tree = createTree({ '': ['only-one'] });
        const { promise, tracker } = runPick({
            tree,
            classify: () => 'terminal',
            responses: [{ pick: 'only-one' }],
        });

        const result = await promise;
        expect(result.picks).to.have.length(1);
        expect(result.picks![0].item).to.equal('only-one');
        tracker.assertAllConsumed();
    });

    it('should NOT auto-skip when multiple skip items exist', async () => {
        const tree = createTree({ '': ['a', 'b'] });
        const { promise, tracker } = runPick({
            tree,
            classify: () => 'skip',
            responses: [{ pick: 'a $(chevron-right)' }],
        });

        const result = await promise;
        expect(result.picks).to.have.length(1);
        expect(result.picks![0].item).to.equal('a');
        tracker.assertAllConsumed();
    });

    it('should throw when no items pass classification at root', async () => {
        const tree = createTree({ '': ['hidden-a', 'hidden-b'] });

        const { promise } = runPick({
            tree,
            classify: () => false,
            responses: [],
        });

        try {
            await promise;
            expect.fail('Expected error');
        } catch (e) {
            expect((e as Error).message).to.include('No items found');
        }
    });

    it('should support canPickMany when all items are terminal', async () => {
        const tree = createTree({ '': ['a', 'b', 'c'] });
        const { promise, tracker } = runPick({
            tree,
            classify: () => 'terminal',
            canPickMany: true,
            responses: [{ pickMany: ['a', 'c'] }],
        });

        const result = await promise;
        expect(result.selectedTerminalPicks).to.deep.equal(['a', 'c']);
        tracker.assertAllConsumed();
    });

    it('should NOT enable canPickMany when items include intermediate', async () => {
        const tree = createTree({ '': ['folder', 'leaf'] });
        const { promise, tracker, mock } = runPick({
            tree,
            classify: (item) => item === 'folder' ? 'intermediate' : 'terminal',
            canPickMany: true,
            responses: [{ pick: 'leaf' }],
        });

        const result = await promise;
        // Should be single-select since not all items are terminal
        expect(result.picks).to.have.length(1);
        expect(result.picks![0].item).to.equal('leaf');
        expect(mock.quickPicks[0].canSelectMany).to.equal(false);
        tracker.assertAllConsumed();
    });

    it('should support create option', async () => {
        const tree = createTree({ '': ['existing'] });
        const { promise, tracker } = runPick({
            tree,
            classify: () => 'terminal',
            create: {
                label: 'Create New',
                createNewItem: () => 'brand-new',
            },
            responses: [{ pick: '$(add) Create New' }],
        });

        const result = await promise;
        expect(result.picks).to.have.length(1);
        expect(result.picks![0].item).to.equal('brand-new');
        tracker.assertAllConsumed();
    });

    it('should support async create option', async () => {
        const tree = createTree({ '': ['existing'] });
        const { promise, tracker } = runPick({
            tree,
            classify: () => 'terminal',
            create: {
                label: 'Create Async',
                createNewItem: () => Promise.resolve('async-item'),
            },
            responses: [{ pick: '$(add) Create Async' }],
        });

        const result = await promise;
        expect(result.picks).to.have.length(1);
        expect(result.picks![0].item).to.equal('async-item');
        tracker.assertAllConsumed();
    });

    it('should handle tree items with label objects', async () => {
        const tree = createTree(
            { '': ['obj-label'] },
            { 'obj-label': { label: { label: 'Object Label' }, id: 'obj' } },
        );

        const { promise, tracker } = runPick({
            tree,
            classify: () => 'terminal',
            responses: [{ pick: 'Object Label' }],
        });

        const result = await promise;
        expect(result.picks).to.have.length(1);
        expect(result.picks![0].item).to.equal('obj-label');
        tracker.assertAllConsumed();
    });
});
