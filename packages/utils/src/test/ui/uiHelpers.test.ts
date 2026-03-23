/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { showSmartInputBox, showSmartQuickPick, withDelayedProgress } from '../../ui/uiHelpers';
import type { IVsCode } from '../../vscode/IVsCode';
import { createMockCodeContext, respondToPrompts } from '../vscode/MockVsCode';

describe('uiHelpers (unit)', () => {
    describe('showSmartInputBox', () => {
        it('should accept input and return the value', async () => {
            const { ctx, mock } = createMockCodeContext();
            respondToPrompts(mock, [{ input: 'hello' }]);

            const result = await showSmartInputBox(ctx, { prompt: 'Enter value' });
            expect(result).to.equal('hello');
        });

        it('should show sync validation message on keystroke', async () => {
            const { ctx, mock } = createMockCodeContext();

            const resultPromise = showSmartInputBox(ctx, {
                prompt: 'Enter value',
                validateInput: (value) => value.length === 0 ? 'Cannot be empty' : undefined,
            });

            const ib = mock.inputBoxes[0];
            ib.changeValue('');
            expect(ib.validationMessage).to.equal('Cannot be empty');

            ib.changeValue('valid');
            expect(ib.validationMessage).to.be.undefined;

            ib.value = 'valid';
            ib.accept();
            const result = await resultPromise;
            expect(result).to.equal('valid');
        });

        it('should run async validation on accept', async () => {
            const { ctx, mock } = createMockCodeContext();
            respondToPrompts(mock, [
                { input: 'good' },
            ]);

            let validatedValue: string | undefined;
            const result = await showSmartInputBox(ctx, {
                prompt: 'Enter value',
                validateInputAsync: (value) => {
                    validatedValue = value;
                    return Promise.resolve(undefined); // passes
                },
            });

            expect(result).to.equal('good');
            expect(validatedValue).to.equal('good');
        });

        it('should show async validation message and re-enable input on failure', async () => {
            const { ctx, mock } = createMockCodeContext();

            let callCount = 0;
            const resultPromise = showSmartInputBox(ctx, {
                prompt: 'Enter value',
                validateInputAsync: () => {
                    callCount++;
                    if (callCount === 1) {
                        return Promise.resolve('Invalid!');
                    }
                    return Promise.resolve(undefined);
                },
            });

            const ib = mock.inputBoxes[0];
            ib.value = 'bad';
            ib.accept(); // triggers async validation → returns 'Invalid!'
            await new Promise(r => { setTimeout(r, 10); }); // let the promise settle
            expect(ib.validationMessage).to.equal('Invalid!');
            expect(ib.enabled).to.be.true;

            ib.value = 'good';
            ib.accept(); // second attempt → passes
            const result = await resultPromise;
            expect(result).to.equal('good');
        });
    });

    describe('showSmartQuickPick', () => {
        it('should return the selected item', async () => {
            const { ctx, mock } = createMockCodeContext();
            respondToPrompts(mock, [{ pick: 'B' }]);

            const result = await showSmartQuickPick(ctx, [
                { label: 'A' },
                { label: 'B' },
                { label: 'C' },
            ]);

            expect(result.label).to.equal('B');
        });

        it('should support multi-select', async () => {
            const { ctx, mock } = createMockCodeContext();
            respondToPrompts(mock, [{ pickMany: ['A', 'C'] }]);

            const result = await showSmartQuickPick(ctx, [
                { label: 'A' },
                { label: 'B' },
                { label: 'C' },
            ], { canPickMany: true });

            expect(result.map(r => r.label)).to.deep.equal(['A', 'C']);
        });

        it('should pre-highlight a recently selected item on subsequent calls', async () => {
            const { ctx, mock } = createMockCodeContext();
            const items = [{ label: 'A' }, { label: 'B' }, { label: 'C' }];

            // First pick: choose 'B' to store it as recent
            respondToPrompts(mock, [{ pick: 'B' }]);
            await showSmartQuickPick(ctx, items);

            // Second pick: 'B' should be marked as recently selected
            respondToPrompts(mock, [{ pick: 'A' }]);
            await showSmartQuickPick(ctx, [{ label: 'A' }, { label: 'B' }, { label: 'C' }]);

            // The second quick pick's items should have 'B' with '(recently selected)'
            const qp = mock.quickPicks[1];
            const bItem = qp.items.find(i => i.label === 'B');
            expect(bItem?.description).to.include('recently selected');
        });

        it('should pre-check recently selected items in multi-select mode', async () => {
            const { ctx, mock } = createMockCodeContext();

            // First pick: multi-select 'A' and 'C'
            respondToPrompts(mock, [{ pickMany: ['A', 'C'] }]);
            await showSmartQuickPick(ctx, [{ label: 'A' }, { label: 'B' }, { label: 'C' }], { canPickMany: true });

            // Second pick: 'A' and 'C' should be pre-checked
            respondToPrompts(mock, [{ pickMany: ['B'] }]);
            await showSmartQuickPick(ctx, [{ label: 'A' }, { label: 'B' }, { label: 'C' }], { canPickMany: true });

            const qp = mock.quickPicks[1];
            const aItem = qp.items.find(i => i.label === 'A');
            const cItem = qp.items.find(i => i.label === 'C');
            expect(aItem?.description).to.include('recently selected');
            expect(cItem?.description).to.include('recently selected');
        });

        it('should use isActiveItem to pre-highlight an item', async () => {
            const { ctx, mock } = createMockCodeContext();

            const resultPromise = showSmartQuickPick(ctx, [
                { label: 'A' },
                { label: 'B' },
                { label: 'C' },
            ], {
                isActiveItem: (item) => item.label === 'C',
            });

            const qp = mock.quickPicks[0];
            expect(qp.activeItems.map(i => i.label)).to.deep.equal(['C']);

            qp.accept();
            const result = await resultPromise;
            expect(result.label).to.equal('C');
        });

        it('should use isSelectedItem to pre-check items in multi-select', async () => {
            const { ctx, mock } = createMockCodeContext();

            const resultPromise = showSmartQuickPick(ctx, [
                { label: 'A' },
                { label: 'B' },
                { label: 'C' },
            ], {
                canPickMany: true,
                isSelectedItem: (item) => item.label === 'A' || item.label === 'B',
            });

            const qp = mock.quickPicks[0];
            expect(qp.selectedItems.map(i => i.label)).to.deep.equal(['A', 'B']);

            // Accept with the pre-selected items
            qp.accept();
            const result = await resultPromise;
            expect(result.map(r => r.label)).to.deep.equal(['A', 'B']);
        });

        it('should invoke onDidTriggerItemButton handler', async () => {
            const { ctx, mock } = createMockCodeContext();

            let triggeredLabel: string | undefined;
            const button = { iconPath: { id: 'trash' } };

            const resultPromise = showSmartQuickPick(ctx, [
                { label: 'A', buttons: [button] },
                { label: 'B' },
            ], {
                onDidTriggerItemButton: (event) => {
                    triggeredLabel = event.item.label;
                },
            });

            const qp = mock.quickPicks[0];
            qp.pressItemButton(qp.items[0], button);
            expect(triggeredLabel).to.equal('A');

            // Still need to pick something to resolve
            qp.activeItems = [qp.items[1]];
            qp.accept();
            await resultPromise;
        });
    });

    describe('withDelayedProgress', () => {
        it('should return immediately when promise resolves before the delay', async () => {
            const code = {} as IVsCode; // withProgress not called when fast
            const result = await withDelayedProgress(code, { location: 1 }, Promise.resolve('fast'), 500);
            expect(result).to.equal('fast');
        });

        it('should show progress when promise takes longer than the delay', async () => {
            let progressCalled = false;
            const code = {
                window: {
                    withProgress: (_opts: unknown, fn: () => Promise<string>) => {
                        progressCalled = true;
                        return fn();
                    },
                },
            } as unknown as IVsCode;

            const slow = new Promise<string>(r => { setTimeout(() => { r('slow'); }, 50); });
            const result = await withDelayedProgress(code, { location: 1 }, slow, 0);
            expect(result).to.equal('slow');
            expect(progressCalled).to.be.true;
        });
    });
});
