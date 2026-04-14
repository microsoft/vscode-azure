/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import type * as vscode from 'vscode';
import { showSmartInputBox, showSmartQuickPick } from '../../ui/uiHelpers';
import { CancellationError } from '../../vscode/CancellationError';
import type { ICodeContext } from '../../vscode/IVsCode';
import { ExecuteStep } from '../../wizard/ExecuteStep';
import { PromptStep } from '../../wizard/PromptStep';
import { Wizard } from '../../wizard/Wizard';
import { createMockCodeContext, respondToPrompts } from '../vscode/MockVsCode';

// ── Test context type ──────────────────────────────────────

interface TestContext {
    name?: string;
    color?: string;
    confirmed?: boolean;
}

// ── Reusable prompt steps ──────────────────────────────────

class NameInputStep extends PromptStep<TestContext> {
    constructor(private readonly ctx: ICodeContext) { super(); }

    public async prompt(): Promise<Partial<TestContext>> {
        const name = await showSmartInputBox(this.ctx, { prompt: 'Enter a name', showBack: true });
        return { name };
    }
}

class ColorPickStep extends PromptStep<TestContext> {
    constructor(private readonly ctx: ICodeContext) { super(); }

    public async prompt(): Promise<Partial<TestContext>> {
        const items: vscode.QuickPickItem[] = [
            { label: 'Red' },
            { label: 'Green' },
            { label: 'Blue' },
        ];
        const picked = await showSmartQuickPick(this.ctx, items, { showBack: true });
        return { color: picked.label };
    }
}

class ConditionalConfirmStep extends PromptStep<TestContext> {
    constructor(private readonly ctx: ICodeContext) { super(); }

    public override shouldPrompt(context: Readonly<TestContext>): boolean {
        return context.color === 'Red';
    }

    public async prompt(): Promise<Partial<TestContext>> {
        const items: vscode.QuickPickItem[] = [
            { label: 'Yes' },
            { label: 'No' },
        ];
        const picked = await showSmartQuickPick(this.ctx, items, { showBack: true });
        return { confirmed: picked.label === 'Yes' };
    }
}

// ── Reusable execute step ──────────────────────────────────

class RecordingExecuteStep extends ExecuteStep<TestContext> {
    public executed = false;
    public receivedContext: TestContext | undefined;

    public execute(context: TestContext): void {
        this.executed = true;
        this.receivedContext = { ...context };
    }
}

// ── Tests ──────────────────────────────────────────────────

describe('Wizard (unit)', () => {

    it('should complete a single-step wizard with an input box', async () => {
        const { ctx, mock } = createMockCodeContext();
        respondToPrompts(mock, [
            { input: 'my-resource' },
        ]);

        const wizard = new Wizard<TestContext>(
            {},
            [new NameInputStep(ctx)],
        );
        const result = await wizard.run();

        expect(result.name).to.equal('my-resource');
    });

    it('should complete a single-step wizard with a quick pick', async () => {
        const { ctx, mock } = createMockCodeContext();
        respondToPrompts(mock, [
            { pick: 'Green' },
        ]);

        const wizard = new Wizard<TestContext>(
            {},
            [new ColorPickStep(ctx)],
        );
        const result = await wizard.run();

        expect(result.color).to.equal('Green');
    });

    it('should complete a multi-step wizard', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tracker = respondToPrompts(mock, [
            { input: 'my-app' },
            { pick: 'Blue' },
        ]);

        const wizard = new Wizard<TestContext>(
            {},
            [new NameInputStep(ctx), new ColorPickStep(ctx)],
        );
        const result = await wizard.run();

        expect(result.name).to.equal('my-app');
        expect(result.color).to.equal('Blue');
        tracker.assertAllConsumed();
    });

    it('should skip a step when shouldPrompt returns false', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tracker = respondToPrompts(mock, [
            { input: 'test' },
            { pick: 'Blue' },
            // No confirm step expected because color !== 'Red'
        ]);

        const wizard = new Wizard<TestContext>(
            {},
            [new NameInputStep(ctx), new ColorPickStep(ctx), new ConditionalConfirmStep(ctx)],
        );
        const result = await wizard.run();

        expect(result.name).to.equal('test');
        expect(result.color).to.equal('Blue');
        expect(result.confirmed).to.be.undefined;
        tracker.assertAllConsumed();
    });

    it('should prompt a conditional step when its condition is met', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tracker = respondToPrompts(mock, [
            { input: 'test' },
            { pick: 'Red' },
            { pick: 'Yes' },
        ]);

        const wizard = new Wizard<TestContext>(
            {},
            [new NameInputStep(ctx), new ColorPickStep(ctx), new ConditionalConfirmStep(ctx)],
        );
        const result = await wizard.run();

        expect(result.name).to.equal('test');
        expect(result.color).to.equal('Red');
        expect(result.confirmed).to.be.true;
        tracker.assertAllConsumed();
    });

    it('should throw CancellationError when user cancels', async () => {
        const { ctx, mock } = createMockCodeContext();
        respondToPrompts(mock, [
            'cancel',
        ]);

        const wizard = new Wizard<TestContext>(
            {},
            [new NameInputStep(ctx)],
        );

        try {
            await wizard.run();
            expect.fail('Expected CancellationError');
        } catch (e) {
            expect(CancellationError.test(e)).to.be.true;
        }
    });

    it('should throw CancellationError when going back past the first step', async () => {
        const { ctx, mock } = createMockCodeContext();
        respondToPrompts(mock, [
            'goBack',
        ]);

        const wizard = new Wizard<TestContext>(
            {},
            [new NameInputStep(ctx)],
        );

        try {
            await wizard.run();
            expect.fail('Expected CancellationError');
        } catch (e) {
            expect(CancellationError.test(e)).to.be.true;
        }
    });

    it('should re-prompt the previous step after going back', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tracker = respondToPrompts(mock, [
            { input: 'first-try' },
            'goBack',            // go back from the color pick to re-prompt name
            { input: 'second-try' },
            { pick: 'Green' },
        ]);

        const wizard = new Wizard<TestContext>(
            {},
            [new NameInputStep(ctx), new ColorPickStep(ctx)],
        );
        const result = await wizard.run();

        expect(result.name).to.equal('second-try');
        expect(result.color).to.equal('Green');
        tracker.assertAllConsumed();
    });

    it('should run execute steps after prompts complete', async () => {
        const { ctx, mock } = createMockCodeContext();
        respondToPrompts(mock, [
            { input: 'my-app' },
        ]);

        const executeStep = new RecordingExecuteStep();
        const wizard = new Wizard<TestContext>(
            {},
            [new NameInputStep(ctx)],
            [executeStep],
        );
        await wizard.run();

        expect(executeStep.executed).to.be.true;
        expect(executeStep.receivedContext?.name).to.equal('my-app');
    });

    it('should skip execute steps when shouldExecute returns false', async () => {
        const { ctx, mock } = createMockCodeContext();
        respondToPrompts(mock, [
            { input: 'my-app' },
        ]);

        class SkippedExecuteStep extends ExecuteStep<TestContext> {
            public executed = false;
            public override shouldExecute(): boolean { return false; }
            public execute(): void { this.executed = true; }
        }

        const executeStep = new SkippedExecuteStep();
        const wizard = new Wizard<TestContext>(
            {},
            [new NameInputStep(ctx)],
            [executeStep],
        );
        await wizard.run();

        expect(executeStep.executed).to.be.false;
    });

    it('should support dynamically added sub-prompt steps', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tracker = respondToPrompts(mock, [
            { pick: 'Red' },
            { pick: 'Yes' },  // from the dynamically added confirm step
        ]);

        class ColorWithSubStep extends PromptStep<TestContext> {
            constructor(private readonly codeCtx: ICodeContext) { super(); }

            public async prompt(): Promise<Partial<TestContext>> {
                const items: vscode.QuickPickItem[] = [
                    { label: 'Red' },
                    { label: 'Blue' },
                ];
                const picked = await showSmartQuickPick(this.codeCtx, items, { showBack: true });
                return { color: picked.label };
            }

            public override getSubPromptSteps(context: Readonly<TestContext>): PromptStep<TestContext>[] {
                if (context.color === 'Red') {
                    return [new ConditionalConfirmStep(this.codeCtx)];
                }
                return [];
            }
        }

        // ConditionalConfirmStep.shouldPrompt checks color === 'Red', which is true
        const wizard = new Wizard<TestContext>(
            {},
            [new ColorWithSubStep(ctx)],
        );
        const result = await wizard.run();

        expect(result.color).to.equal('Red');
        expect(result.confirmed).to.be.true;
        tracker.assertAllConsumed();
    });

    it('should merge base context with prompt results', async () => {
        const { ctx, mock } = createMockCodeContext();
        respondToPrompts(mock, [
            { pick: 'Blue' },
        ]);

        const wizard = new Wizard<TestContext>(
            { name: 'preset-name' },
            [new ColorPickStep(ctx)],
        );
        const result = await wizard.run();

        expect(result.name).to.equal('preset-name');
        expect(result.color).to.equal('Blue');
    });

    it('should run a wizard with no prompt steps', async () => {
        const executeStep = new RecordingExecuteStep();
        const wizard = new Wizard<TestContext>(
            { name: 'pre-filled' },
            [],
            [executeStep],
        );
        const result = await wizard.run();

        expect(result.name).to.equal('pre-filled');
        expect(executeStep.executed).to.be.true;
    });

    it('should run execute sub-steps after their parent', async () => {
        const order: string[] = [];

        class ParentExecuteStep extends ExecuteStep<TestContext> {
            public execute(): void { order.push('parent'); }
            public override getSubExecuteSteps(): ExecuteStep<TestContext>[] {
                return [new ChildExecuteStep()];
            }
        }

        class ChildExecuteStep extends ExecuteStep<TestContext> {
            public execute(): void { order.push('child'); }
        }

        const wizard = new Wizard<TestContext>(
            {},
            [],
            [new ParentExecuteStep()],
        );
        await wizard.run();

        expect(order).to.deep.equal(['parent', 'child']);
    });

    it('should clean up sub-prompt steps when going back', async () => {
        const { ctx, mock } = createMockCodeContext();

        class StepWithSub extends PromptStep<TestContext> {
            constructor(private readonly codeCtx: ICodeContext) { super(); }

            public async prompt(): Promise<Partial<TestContext>> {
                const items: vscode.QuickPickItem[] = [{ label: 'Red' }, { label: 'Blue' }];
                const picked = await showSmartQuickPick(this.codeCtx, items, { showBack: true });
                return { color: picked.label };
            }

            public override getSubPromptSteps(context: Readonly<TestContext>): PromptStep<TestContext>[] {
                if (context.color === 'Red') {
                    return [new ConditionalConfirmStep(this.codeCtx)];
                }
                return [];
            }
        }

        const tracker = respondToPrompts(mock, [
            { input: 'first' },
            { pick: 'Red' },       // StepWithSub picks Red → adds ConditionalConfirmStep
            'goBack',              // Go back from ConditionalConfirmStep → removes it
            { pick: 'Blue' },      // Re-pick StepWithSub with Blue -> no sub-steps
        ]);

        const wizard = new Wizard<TestContext>(
            {},
            [new NameInputStep(ctx), new StepWithSub(ctx)],
        );
        const result = await wizard.run();

        expect(result.name).to.equal('first');
        expect(result.color).to.equal('Blue');
        expect(result.confirmed).to.be.undefined;
        tracker.assertAllConsumed();
    });
});
