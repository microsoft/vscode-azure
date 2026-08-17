/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWorkspaceFolder, showMessage, showSmartInputBox, showSmartQuickPick, withDelayedProgress, type MessageSeverity } from '../../src/ui/uiHelpers';
import { CancellationError } from '../../src/vscode/CancellationError';
import type { IVsCode } from '../../src/vscode/IVsCode';
import { GoBackError } from '../../src/wizard/GoBackError';
import { MockUri } from '../vscode/MockUri';
import { createMockCodeContext, createMockVsCode, respondToPrompts } from '../vscode/MockVsCode';

describe('uiHelpers (unit)', () => {
    describe('showMessage', () => {
        it('should show an information message by default', async () => {
            const mockResult = createMockVsCode();
            const responses = respondToPrompts(mockResult, [{ button: 'Open' }]);

            const result = await showMessage(mockResult.vscode, 'Deployed', { modal: true }, 'Open');

            expect(result).to.equal('Open');
            expect(mockResult.window.showInformationMessage.mock.callCount()).to.equal(1);
            expect(mockResult.window.showInformationMessage.mock.calls[0].arguments).to.deep.equal([
                'Deployed',
                { modal: true },
                'Open',
            ]);
            responses.assertAllConsumed();
        });

        it('should show a warning message', async () => {
            const mockResult = createMockVsCode();

            await showMessage(mockResult.vscode, 'Careful', { severity: 'warning' });

            expect(mockResult.window.showWarningMessage.mock.callCount()).to.equal(1);
            expect(mockResult.window.showWarningMessage.mock.calls[0].arguments).to.deep.equal([
                'Careful',
                {},
            ]);
        });

        it('should show an error message', async () => {
            const mockResult = createMockVsCode();

            await showMessage(mockResult.vscode, 'Failed', { severity: 'error' });

            expect(mockResult.window.showErrorMessage.mock.callCount()).to.equal(1);
            expect(mockResult.window.showErrorMessage.mock.calls[0].arguments).to.deep.equal([
                'Failed',
                {},
            ]);
        });

        it('should return undefined when a non-modal message is dismissed', async () => {
            const mockResult = createMockVsCode();

            const result = await showMessage(mockResult.vscode, 'Status', {});

            expect(result).to.be.undefined;
        });

        it('should throw CancellationError with the step name when a modal message is dismissed', async () => {
            const mockResult = createMockVsCode();
            respondToPrompts(mockResult, ['cancel']);

            const error = await showMessage(
                mockResult.vscode,
                'Continue?',
                { modal: true, stepName: 'confirmOperation' },
                'Continue',
            ).then(() => undefined, (reason: unknown) => reason);

            expect(error).to.be.instanceOf(CancellationError);
            expect((error as CancellationError).stepName).to.equal('confirmOperation');
        });

        it('should reject an unsupported severity', async () => {
            const mockResult = createMockVsCode();

            await expect(showMessage(mockResult.vscode, 'Status', {
                severity: 'unsupported' as MessageSeverity,
            })).to.be.rejectedWith(Error, 'Unsupported message severity: unsupported');
        });

        it('should reject a response for a button the message does not offer', async () => {
            const mockResult = createMockVsCode();
            respondToPrompts(mockResult, [{ button: 'Retry' }]);

            await expect(showMessage(
                mockResult.vscode,
                'Continue?',
                { modal: true },
                'Continue',
            )).to.be.rejectedWith(Error, 'Message does not have a \'Retry\' button');
        });
    });

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
            ib.accept(); // triggers async validation -> returns 'Invalid!'
            await new Promise(r => { setTimeout(r, 10); }); // let the promise settle
            expect(ib.validationMessage).to.equal('Invalid!');
            expect(ib.enabled).to.be.true;

            ib.value = 'good';
            ib.accept(); // second attempt -> passes
            const result = await resultPromise;
            expect(result).to.equal('good');
        });

        it('should reject with GoBackError when back button is pressed on input box', async () => {
            const { ctx, mock } = createMockCodeContext();
            respondToPrompts(mock, ['goBack']);

            await expect(showSmartInputBox(ctx, { prompt: 'Enter value', showBack: true })).to.be.rejectedWith(GoBackError);
        });

        it('should restore recently entered value on subsequent calls', async () => {
            const { ctx, mock } = createMockCodeContext();

            // First call: enter 'hello' to store it as recent
            respondToPrompts(mock, [{ input: 'hello' }]);
            await showSmartInputBox(ctx, { prompt: 'Enter value' });

            // Second call: accept the default (which should be the recent value)
            respondToPrompts(mock, ['acceptDefault']);
            const result = await showSmartInputBox(ctx, { prompt: 'Enter value' });
            expect(result).to.equal('hello');
        });

        it('should use fallbackValue when no recent input is available', async () => {
            const { ctx, mock } = createMockCodeContext();

            respondToPrompts(mock, ['acceptDefault']);
            const result = await showSmartInputBox(ctx, {
                prompt: 'Enter value',
                fallbackValue: 'default-val',
            });

            expect(result).to.equal('default-val');
        });

        it('should prefer recent input over fallbackValue', async () => {
            const { ctx, mock } = createMockCodeContext();

            // First call: enter 'hello' to store it as recent
            respondToPrompts(mock, [{ input: 'hello' }]);
            await showSmartInputBox(ctx, { prompt: 'Enter value', fallbackValue: 'default-val' });

            // Second call: accept the default (should be 'hello', not 'default-val')
            respondToPrompts(mock, ['acceptDefault']);
            const result = await showSmartInputBox(ctx, { prompt: 'Enter value', fallbackValue: 'default-val' });
            expect(result).to.equal('hello');
        });

        describe('rememberRecent', () => {
            it('should not persist the value when rememberRecent is false', async () => {
                const { ctx, mock } = createMockCodeContext();

                respondToPrompts(mock, [{ input: 'super-secret' }]);
                await showSmartInputBox(ctx, { prompt: 'Enter value', rememberRecent: false });

                // Nothing about the value may reach workspace state -- it is often a secret.
                const state = ctx.extensionContext.workspaceState;
                const stored = state.keys().map(key => String(state.get(key)));
                expect(stored).to.not.include('super-secret');
            });

            it('should not restore a value from a prompt that opted out', async () => {
                const { ctx, mock } = createMockCodeContext();

                respondToPrompts(mock, [{ input: 'super-secret' }]);
                await showSmartInputBox(ctx, { prompt: 'Enter value', rememberRecent: false });

                respondToPrompts(mock, ['acceptDefault']);
                const result = await showSmartInputBox(ctx, { prompt: 'Enter value', rememberRecent: false });

                expect(result).to.equal('');
            });

            it('should treat a password prompt as opted out even without the flag', async () => {
                const { ctx, mock } = createMockCodeContext();

                respondToPrompts(mock, [{ input: 'super-secret' }]);
                await showSmartInputBox(ctx, { prompt: 'Enter value', password: true });

                respondToPrompts(mock, ['acceptDefault']);
                const result = await showSmartInputBox(ctx, { prompt: 'Enter value', password: true });

                expect(result).to.equal('');
            });

            it('should still apply fallbackValue when the prompt opted out', async () => {
                const { ctx, mock } = createMockCodeContext();

                respondToPrompts(mock, ['acceptDefault']);
                const result = await showSmartInputBox(ctx, {
                    prompt: 'Enter value',
                    fallbackValue: 'default-val',
                    rememberRecent: false,
                });

                expect(result).to.equal('default-val');
            });

            it('should still apply fallbackValue for a password prompt', async () => {
                const { ctx, mock } = createMockCodeContext();

                respondToPrompts(mock, ['acceptDefault']);
                const result = await showSmartInputBox(ctx, {
                    prompt: 'Enter value',
                    fallbackValue: 'default-val',
                    password: true,
                });

                expect(result).to.equal('default-val');
            });
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

        it('should find recently selected item even when items array is reused', async () => {
            const { ctx, mock } = createMockCodeContext();
            const items = [{ label: 'A' }, { label: 'B' }, { label: 'C' }];

            // First pick: choose 'B' with the same array
            respondToPrompts(mock, [{ pick: 'B' }]);
            await showSmartQuickPick(ctx, items);

            // Second pick: reuse the SAME items array (descriptions are now mutated)
            respondToPrompts(mock, [{ pick: 'A' }]);
            await showSmartQuickPick(ctx, items);

            const qp = mock.quickPicks[1];
            const bItem = qp.items.find(i => i.label === 'B');
            expect(bItem?.description).to.include('recently selected');
        });

        it('should sort recently selected item to the top', async () => {
            const { ctx, mock } = createMockCodeContext();

            // First pick: choose 'C' (last item)
            respondToPrompts(mock, [{ pick: 'C' }]);
            await showSmartQuickPick(ctx, [{ label: 'A' }, { label: 'B' }, { label: 'C' }]);

            // Second pick: 'C' should appear first in the list
            respondToPrompts(mock, [{ pick: 'A' }]);
            await showSmartQuickPick(ctx, [{ label: 'A' }, { label: 'B' }, { label: 'C' }]);

            const qp = mock.quickPicks[1];
            expect(qp.items[0].label).to.equal('C');
            expect(qp.items[1].label).to.equal('A');
            expect(qp.items[2].label).to.equal('B');
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

        it('should reject with GoBackError when back button is pressed on quick pick', async () => {
            const { ctx, mock } = createMockCodeContext();
            respondToPrompts(mock, ['goBack']);

            await expect(showSmartQuickPick(ctx, [
                { label: 'A' },
                { label: 'B' },
            ], { showBack: true })).to.be.rejectedWith(GoBackError);
        });

        describe('combo box (createItemFromValue)', () => {
            it('should synthesize an item from the typed value when it matches no suggestion', async () => {
                const { ctx, mock } = createMockCodeContext();
                respondToPrompts(mock, [{ value: 'typed-id' }]);

                const result = await showSmartQuickPick(ctx, [
                    { label: 'Alpha', data: 'a' },
                    { label: 'Bravo', data: 'b' },
                ], {
                    createItemFromValue: (value) => value ? { label: `Use ${value}`, data: value } : undefined,
                });

                expect(result.data).to.equal('typed-id');
                expect(result.label).to.equal('Use typed-id');
            });

            it('should list the synthetic item after the existing suggestions', async () => {
                const { ctx, mock } = createMockCodeContext();
                const createItemFromValue = (value: string) => value ? { label: `Use ${value}`, data: value } : undefined;

                const resultPromise = showSmartQuickPick(ctx, [
                    { label: 'Alpha', data: 'a' },
                    { label: 'Bravo', data: 'b' },
                ], { createItemFromValue });

                const qp = mock.quickPicks[0];
                qp.changeValue('typed-id');

                // Suggestions come first; the synthetic "use what I typed" entry is last.
                expect(qp.items.map(i => i.label)).to.deep.equal(['Alpha', 'Bravo', 'Use typed-id']);

                qp.accept();
                expect((await resultPromise).data).to.equal('typed-id');
            });

            it('should keep a filter-matching suggestion active instead of the synthetic item', async () => {
                const { ctx, mock } = createMockCodeContext();
                const createItemFromValue = (value: string) => value ? { label: `Use ${value}`, data: value } : undefined;

                const resultPromise = showSmartQuickPick(ctx, [
                    { label: 'Alpha', data: 'a' },
                    { label: 'Bravo', data: 'b' },
                ], { createItemFromValue });

                const qp = mock.quickPicks[0];
                qp.changeValue('Al');

                // The synthetic is still offered (last), but the matching 'Alpha'
                // suggestion -- not the synthetic -- is the active/default item.
                expect(qp.items[qp.items.length - 1].label).to.equal('Use Al');
                expect(qp.activeItems.map(i => i.label)).to.deep.equal(['Alpha']);

                qp.accept();
                expect((await resultPromise).data).to.equal('a');
            });

            it('should make the synthetic item active when no suggestion matches the filter', async () => {
                const { ctx, mock } = createMockCodeContext();
                const createItemFromValue = (value: string) => value ? { label: `Use ${value}`, data: value } : undefined;

                const resultPromise = showSmartQuickPick(ctx, [
                    { label: 'Alpha', data: 'a' },
                    { label: 'Bravo', data: 'b' },
                ], { createItemFromValue });

                const qp = mock.quickPicks[0];
                // 'zzz' matches neither suggestion, so the synthetic is the only
                // visible item and must be active -- hitting enter accepts it.
                qp.changeValue('zzz');

                expect(qp.activeItems.map(i => i.label)).to.deep.equal(['Use zzz']);

                qp.accept();
                expect((await resultPromise).data).to.equal('zzz');
            });

            it('should accept the synthetic item even if nothing was auto-activated', async () => {
                const { ctx, mock } = createMockCodeContext();
                const createItemFromValue = (value: string) => value ? { label: `Use ${value}`, data: value } : undefined;

                const resultPromise = showSmartQuickPick(ctx, [
                    { label: 'Alpha', data: 'a' },
                    { label: 'Bravo', data: 'b' },
                ], { createItemFromValue });

                const qp = mock.quickPicks[0];
                qp.changeValue('zzz');

                // Simulate a VS Code version/edge case where the synthetic is offered
                // but not auto-focused: accepting must still resolve it rather than
                // silently no-op and leave the picker hanging open.
                qp.activeItems = [];
                qp.accept();

                expect((await resultPromise).data).to.equal('zzz');
            });

            it('should return a suggested item when picked instead of synthesizing one', async () => {
                const { ctx, mock } = createMockCodeContext();
                respondToPrompts(mock, [{ pick: 'Bravo' }]);

                const result = await showSmartQuickPick(ctx, [
                    { label: 'Alpha', data: 'a' },
                    { label: 'Bravo', data: 'b' },
                ], {
                    createItemFromValue: (value) => value ? { label: `Use ${value}`, data: value } : undefined,
                });

                expect(result.data).to.equal('b');
            });

            it('should still allow entering a value when there are no suggestions', async () => {
                const { ctx, mock } = createMockCodeContext();
                respondToPrompts(mock, [{ value: 'only-typed' }]);

                const result = await showSmartQuickPick(ctx, [], {
                    createItemFromValue: (value) => value ? { label: `Use ${value}`, data: value } : undefined,
                });

                expect(result.data).to.equal('only-typed');
            });

            it('should not let a typed value overwrite a remembered suggestion', async () => {
                const { ctx, mock } = createMockCodeContext();
                const createItemFromValue = (value: string) => value ? { label: `Use ${value}`, data: value } : undefined;

                // First call: pick a real suggestion so it is remembered.
                respondToPrompts(mock, [{ pick: 'Bravo' }]);
                await showSmartQuickPick(ctx, [
                    { label: 'Alpha', data: 'a' },
                    { label: 'Bravo', data: 'b' },
                ], { createItemFromValue });

                // Second call: type a free-form value instead of picking. This must
                // not clobber the remembered 'Bravo'.
                respondToPrompts(mock, [{ value: 'typed-id' }]);
                await showSmartQuickPick(ctx, [
                    { label: 'Alpha', data: 'a' },
                    { label: 'Bravo', data: 'b' },
                ], { createItemFromValue });

                // Third call: 'Bravo' should still be the remembered choice.
                respondToPrompts(mock, [{ pick: 'Alpha' }]);
                await showSmartQuickPick(ctx, [
                    { label: 'Alpha', data: 'a' },
                    { label: 'Bravo', data: 'b' },
                ], { createItemFromValue });

                const qp = mock.quickPicks[2];
                const bravo = qp.items.find(i => i.label === 'Bravo');
                expect(bravo?.description, 'Bravo should still be remembered').to.include('recently selected');
            });

            it('should clear the active synthetic item when the typed value is removed', async () => {
                const { ctx, mock } = createMockCodeContext();
                const createItemFromValue = (value: string) => value ? { label: `Use ${value}`, data: value } : undefined;

                const resultPromise = showSmartQuickPick(ctx, [
                    { label: 'Alpha', data: 'a' },
                    { label: 'Bravo', data: 'b' },
                ], { createItemFromValue });

                const qp = mock.quickPicks[0];

                // Type a value: a synthetic item is offered and made active.
                qp.changeValue('typed-id');
                expect(qp.activeItems.map(i => i.label)).to.deep.equal(['Use typed-id']);

                // Clear the value: the synthetic item is removed, so it can no
                // longer be active (accepting it would resolve an item no longer
                // in `items`). VS Code re-highlights the first real suggestion.
                qp.changeValue('');
                expect(qp.activeItems.map(i => i.label)).to.deep.equal(['Alpha']);
                expect(qp.items.map(i => i.label)).to.deep.equal(['Alpha', 'Bravo']);

                // Pick a real suggestion to settle the prompt; only its label is remembered.
                qp.activeItems = [qp.items[1]];
                qp.accept();

                const result = await resultPromise;
                expect(result.data).to.equal('b');

                // The synthetic 'Use typed-id' must not have been remembered: a
                // follow-up prompt marks the real 'Bravo' as recently selected.
                respondToPrompts(mock, [{ pick: 'Alpha' }]);
                await showSmartQuickPick(ctx, [
                    { label: 'Alpha', data: 'a' },
                    { label: 'Bravo', data: 'b' },
                ], { createItemFromValue });

                const followUp = mock.quickPicks[1];
                const bravo = followUp.items.find(i => i.label === 'Bravo');
                expect(bravo?.description, 'Bravo should be remembered').to.include('recently selected');
            });

            it('should not offer a duplicate synthetic item when the typed value matches a suggestion', async () => {
                const { ctx, mock } = createMockCodeContext();
                // Factory echoes the value as the item label so a typed 'Bravo'
                // produces a label that collides with the real 'Bravo' suggestion.
                const createItemFromValue = (value: string) => value ? { label: value, data: `typed:${value}` } : undefined;

                const resultPromise = showSmartQuickPick(ctx, [
                    { label: 'Alpha', data: 'a' },
                    { label: 'Bravo', data: 'b' },
                ], { createItemFromValue });

                const qp = mock.quickPicks[0];
                qp.changeValue('Bravo');

                // No duplicate row should be inserted, and exactly one item (the real
                // suggestion, not a synthetic 'typed:Bravo') should be active.
                expect(qp.items.map(i => i.label)).to.deep.equal(['Alpha', 'Bravo']);
                expect(qp.activeItems).to.have.lengthOf(1);

                qp.accept();
                const result = await resultPromise;
                // data 'b' (not 'typed:Bravo') confirms the real suggestion was accepted.
                expect(result.data).to.equal('b');

                // Accepting the real suggestion remembers it (a synthetic item would not).
                respondToPrompts(mock, [{ pick: 'Alpha' }]);
                await showSmartQuickPick(ctx, [
                    { label: 'Alpha', data: 'a' },
                    { label: 'Bravo', data: 'b' },
                ], { createItemFromValue });
                const followUp = mock.quickPicks[1];
                const bravo = followUp.items.find(i => i.label === 'Bravo');
                expect(bravo?.description, 'Bravo should be remembered').to.include('recently selected');
            });

            it('should restore the recent pre-highlight after the typed value is cleared', async () => {
                const { ctx, mock } = createMockCodeContext();
                const createItemFromValue = (value: string) => value ? { label: `Use ${value}`, data: value } : undefined;
                const items = () => [
                    { label: 'Alpha', data: 'a' },
                    { label: 'Bravo', data: 'b' },
                ];

                // First call: pick 'Bravo' so it becomes the remembered choice.
                const firstPromise = showSmartQuickPick(ctx, items(), { createItemFromValue });
                const qp0 = mock.quickPicks[0];
                qp0.activeItems = [qp0.items[1]];
                qp0.accept();
                expect((await firstPromise).data).to.equal('b');

                // Second call: 'Bravo' is pre-highlighted; type then clear the value.
                const resultPromise = showSmartQuickPick(ctx, items(), { createItemFromValue });
                const qp = mock.quickPicks[1];
                const recentItem = qp.activeItems[0];
                expect(recentItem.label, 'recent item pre-highlighted').to.equal('Bravo');

                qp.changeValue('typed-id');
                expect(qp.activeItems[0].label).to.equal('Use typed-id');

                // Clearing restores the recent pre-highlight rather than blanking it.
                qp.changeValue('');
                expect(qp.activeItems).to.deep.equal([recentItem]);

                qp.accept();
                const result = await resultPromise;
                expect(result.data).to.equal('b');
            });
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

    describe('getWorkspaceFolder', () => {
        it('should return undefined when there are no workspace folders', async () => {
            const { vscode: code } = createMockVsCode();

            const result = await getWorkspaceFolder(code);

            expect(result).to.be.undefined;
        });

        it('should return the single folder when there is exactly one', async () => {
            const { vscode: code, workspaceFolders } = createMockVsCode();
            const folder = { uri: MockUri.file('/project'), name: 'project', index: 0 };
            workspaceFolders.push(folder);

            const result = await getWorkspaceFolder(code);

            expect(result).to.equal(folder);
        });

        it('should call showWorkspaceFolderPick when there are multiple folders', async () => {
            const folder1 = { uri: MockUri.file('/project1'), name: 'project1', index: 0 };
            const folder2 = { uri: MockUri.file('/project2'), name: 'project2', index: 1 };

            const mockResult = createMockVsCode();
            mockResult.workspaceFolders.push(folder1, folder2);

            const showPick = mockResult.window.showWorkspaceFolderPick as unknown as ReturnType<typeof import('node:test').mock.fn>;
            showPick.mock.mockImplementation(() => Promise.resolve(folder2));

            const result = await getWorkspaceFolder(mockResult.vscode);

            expect(result).to.equal(folder2);
            expect(showPick.mock.callCount()).to.equal(1);
        });

        it('should pass placeHolder to showWorkspaceFolderPick', async () => {
            const folder1 = { uri: MockUri.file('/a'), name: 'a', index: 0 };
            const folder2 = { uri: MockUri.file('/b'), name: 'b', index: 1 };

            const mockResult = createMockVsCode();
            mockResult.workspaceFolders.push(folder1, folder2);

            const showPick = mockResult.window.showWorkspaceFolderPick as unknown as ReturnType<typeof import('node:test').mock.fn>;
            showPick.mock.mockImplementation(() => Promise.resolve(folder1));

            await getWorkspaceFolder(mockResult.vscode, { placeHolder: 'Pick a folder' });

            const opts = showPick.mock.calls[0].arguments[0] as { placeHolder?: string };
            expect(opts.placeHolder).to.equal('Pick a folder');
        });

        it('should throw CancellationError when the user dismisses the picker', async () => {
            const folder1 = { uri: MockUri.file('/a'), name: 'a', index: 0 };
            const folder2 = { uri: MockUri.file('/b'), name: 'b', index: 1 };

            const mockResult = createMockVsCode();
            mockResult.workspaceFolders.push(folder1, folder2);

            const showPick = mockResult.window.showWorkspaceFolderPick as unknown as ReturnType<typeof import('node:test').mock.fn>;
            showPick.mock.mockImplementation(() => Promise.resolve(undefined));

            await expect(getWorkspaceFolder(mockResult.vscode)).to.be.rejectedWith(CancellationError);
        });

        it('should include the step name when the user dismisses the picker', async () => {
            const folder1 = { uri: MockUri.file('/a'), name: 'a', index: 0 };
            const folder2 = { uri: MockUri.file('/b'), name: 'b', index: 1 };
            const mockResult = createMockVsCode();
            mockResult.workspaceFolders.push(folder1, folder2);

            const showPick = mockResult.window.showWorkspaceFolderPick;
            showPick.mock.mockImplementation(() => Promise.resolve(undefined));

            const error = await getWorkspaceFolder(mockResult.vscode, { stepName: 'selectFolder' })
                .then(() => undefined, (reason: unknown) => reason);

            expect(error).to.be.instanceOf(CancellationError);
            expect((error as CancellationError).stepName).to.equal('selectFolder');
        });
    });
});
