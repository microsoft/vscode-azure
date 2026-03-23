/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { PickClassification } from '../../../tree/pick/GenericPickStep';
import type { PickContext } from '../../../tree/pick/PickContext';
import { RecursivePickStep } from '../../../tree/pick/RecursivePickStep';
import type { ITreeItem } from '../../../vscode/IVsCode';
import { Wizard } from '../../../wizard/Wizard';
import { createMockCodeContext, respondToPrompts } from '../../vscode/MockVsCode';

// Simple tree of string keys
function createTree(data: Record<string, string[]>) {
    return {
        getChildren(key?: string): string[] {
            return data[key ?? ''] ?? [];
        },
        getTreeItem(key: string): ITreeItem {
            return { label: key, id: key };
        },
    };
}

describe('RecursivePickStep (unit)', () => {
    it('should pick a terminal item at the root', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tree = createTree({ '': ['leaf-a', 'leaf-b'] });

        const tracker = respondToPrompts(mock, [
            { pick: 'leaf-a' },
        ]);

        const wizard = new Wizard<PickContext<string>>(
            { picks: [] },
            [new RecursivePickStep({
                ...ctx,
                tree,
                classify: () => 'terminal',
            })],
        );

        const result = await wizard.run();

        expect(result.picks).to.have.length(1);
        expect(result.picks[0].item).to.equal('leaf-a');
        tracker.assertAllConsumed();
    });

    it('should drill through intermediate items to reach a terminal', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tree = createTree({
            '': ['group'],
            'group': ['item-1', 'item-2'],
        });

        const tracker = respondToPrompts(mock, [
            { pick: 'group $(chevron-right)' },
            { pick: 'item-2' },
        ]);

        const wizard = new Wizard<PickContext<string>>(
            { picks: [] },
            [new RecursivePickStep({
                ...ctx,
                tree,
                classify: (item: string) => item === 'group' ? 'intermediate' : 'terminal',
            })],
        );

        const result = await wizard.run();

        expect(result.picks).to.have.length(2);
        expect(result.picks[0].item).to.equal('group');
        expect(result.picks[1].item).to.equal('item-2');
        tracker.assertAllConsumed();
    });

    it('should auto-skip a single skip-classified item', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tree = createTree({
            '': ['only-group'],
            'only-group': ['leaf'],
        });

        const tracker = respondToPrompts(mock, [
            { pick: 'leaf' },  // only-group is auto-skipped
        ]);

        const wizard = new Wizard<PickContext<string>>(
            { picks: [] },
            [new RecursivePickStep({
                ...ctx,
                tree,
                classify: (item: string) => item === 'only-group' ? 'skip' : 'terminal',
            })],
        );

        const result = await wizard.run();

        expect(result.picks).to.have.length(2);
        expect(result.picks[0].item).to.equal('only-group');
        expect(result.picks[1].item).to.equal('leaf');
        tracker.assertAllConsumed();
    });

    it('should hide items classified as false', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tree = createTree({
            '': ['visible', 'hidden'],
        });

        const tracker = respondToPrompts(mock, [
            { pick: 'visible' },
        ]);

        const classify = (item: string): PickClassification =>
            item === 'hidden' ? false : 'terminal';

        const wizard = new Wizard<PickContext<string>>(
            { picks: [] },
            [new RecursivePickStep({ ...ctx, tree, classify })],
        );

        const result = await wizard.run();

        expect(result.picks[0].item).to.equal('visible');
        tracker.assertAllConsumed();
    });

    it('should throw when no items pass classification', async () => {
        const { ctx } = createMockCodeContext();
        const tree = createTree({ '': ['hidden-a', 'hidden-b'] });

        const wizard = new Wizard<PickContext<string>>(
            { picks: [] },
            [new RecursivePickStep({
                ...ctx,
                tree,
                classify: () => false,
            })],
        );

        try {
            await wizard.run();
            expect.fail('Expected error');
        } catch (e) {
            expect((e as Error).message).to.include('No items found');
        }
    });

    it('should support multi-level recursion', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tree = createTree({
            '': ['l1'],
            'l1': ['l2'],
            'l2': ['l3'],
            'l3': ['leaf'],
        });

        const tracker = respondToPrompts(mock, [
            { pick: 'l1 $(chevron-right)' },
            { pick: 'l2 $(chevron-right)' },
            { pick: 'l3 $(chevron-right)' },
            { pick: 'leaf' },
        ]);

        const wizard = new Wizard<PickContext<string>>(
            { picks: [] },
            [new RecursivePickStep({
                ...ctx,
                tree,
                classify: (item: string) => item === 'leaf' ? 'terminal' : 'intermediate',
            })],
        );

        const result = await wizard.run();

        expect(result.picks).to.have.length(4);
        expect(result.picks[3].item).to.equal('leaf');
        tracker.assertAllConsumed();
    });
});
