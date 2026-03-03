/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from '../vscode/CancellationError';
import type { ExecuteStep } from './ExecuteStep';
import { GoBackError } from './GoBackError';
import type { PromptStep } from './PromptStep';

/**
 * Tracks one prompted step and everything it contributed.
 * @internal
 */
interface PromptRecord<TContext> {
    readonly step: PromptStep<TContext>;
    readonly stepResult: Partial<TContext> | undefined | null;
    childPrompts?: readonly PromptStep<TContext>[];
}

/**
 * A multi-step wizard that separates user prompting from execution.
 *
 * **Prompt phase** -- Steps run in order, each returning a partial
 * context that is merged into the accumulated state. Steps may
 * dynamically add further prompt steps by overriding
 * {@link PromptStep.getSubPromptSteps}. Back navigation is
 * supported: throwing {@link GoBackError} from a prompt step returns
 * to the previous prompted step, automatically discarding its context
 * contribution and any dynamically added children.
 *
 * **Execute phase** -- After all prompts complete, execute steps run
 * in the order they were registered. Only steps whose
 * {@link ExecuteStep.shouldExecute} returns `true` (or is omitted)
 * are run. Steps may add sub-steps via
 * {@link ExecuteStep.getSubExecuteSteps}; these run immediately after their
 * parent.
 *
 * @typeParam TContext - The shared context object accumulated across
 *   all steps.
 */
export class Wizard<TContext extends object> {
    /**
     * @param baseContext - The initial context object to build upon.
     * @param promptSteps - Prompt steps, executed in order.
     * @param executeSteps - Execute steps, executed in order after
     *   all prompts complete.
     */
    public constructor(
        private readonly baseContext: TContext,
        private readonly promptSteps: PromptStep<TContext>[],
        private readonly executeSteps: ExecuteStep<TContext>[] = [],
    ) { }

    /**
     * Run the wizard: prompt phase followed by execute phase.
     *
     * @throws a {@link CancellationError} if the user cancels or goes back
     *   past the first step.
     * @returns The final accumulated context after both phases. Note that
     *   this will be a new object, not the originally passed-in {@link baseContext}.
     */
    public async run(): Promise<TContext> {
        const context = await this.runPromptPhase();
        await this.runExecutePhase(context);
        return context;
    }

    // ── Context helpers ─────────────────────────────────────────

    /**
     * Rebuild the accumulated context from the base context and all
     * prompt result layers. Creates a new top-level context object each time
     * by shallowly merging layers, so callers always receive a fresh reference;
     * nested objects from the base context or step results may still be shared
     * and mutable.
     */
    private buildContext(history: PromptRecord<TContext>[]): TContext {
        const merged = Object.assign({} as TContext, this.baseContext);
        for (const record of history) {
            if (record.stepResult) {
                Object.assign(merged, record.stepResult);
            }
        }
        return merged;
    }

    // ── Prompt phase ────────────────────────────────────────────

    private async runPromptPhase(): Promise<TContext> {
        /** Steps that were actually prompted (not skipped), in order. */
        const history: PromptRecord<TContext>[] = [];

        /**
         * Recursively remove a record and everything it added.
         */
        const removeChildren = (record: PromptRecord<TContext>): void => {
            // Remove child prompt steps (depth-first)
            for (const child of record.childPrompts ?? []) {
                // Find and clean up child's own record if it was prompted
                const childRecordIdx = history.findIndex(r => r.step === child);
                if (childRecordIdx !== -1) {
                    removeChildren(history[childRecordIdx]);
                    history.splice(childRecordIdx, 1);
                }

                // Remove from step list
                const stepIdx = this.promptSteps.indexOf(child);
                if (stepIdx !== -1) {
                    this.promptSteps.splice(stepIdx, 1);
                }
            }
        };

        let cursor = 0;

        while (cursor < this.promptSteps.length) {
            const step = this.promptSteps[cursor];
            const context = this.buildContext(history);

            // Skip steps that opt out
            if (!await step.shouldPrompt(context)) {
                cursor++;
                continue;
            }

            try {
                const stepResult = await step.prompt(context);

                const record: PromptRecord<TContext> = {
                    step,
                    stepResult,
                };

                // Rebuild context with this step's contribution included
                const updatedContext = this.buildContext([...history, record]);

                // Collect dynamically added child steps
                record.childPrompts = step.getSubPromptSteps(updatedContext);

                // Insert child prompt steps after current
                if (record.childPrompts.length > 0) {
                    this.promptSteps.splice(cursor + 1, 0, ...record.childPrompts);
                }

                history.push(record);
                cursor++;
            } catch (error) {
                if (GoBackError.test(error)) {
                    // Pop the previous prompted step
                    const prevRecord = history.pop();
                    if (!prevRecord) {
                        // Nothing to go back to -- treat as cancellation
                        throw new CancellationError();
                    }

                    // Recursively remove everything the previous step added
                    removeChildren(prevRecord);

                    // Move cursor back to re-prompt the previous step
                    cursor = this.promptSteps.indexOf(prevRecord.step);
                } else {
                    throw error;
                }
            }
        }

        return this.buildContext(history);
    }

    // ── Execute phase ───────────────────────────────────────────

    private async runExecutePhase(context: TContext): Promise<void> {
        let cursor = 0;
        while (cursor < this.executeSteps.length) {
            const step = this.executeSteps[cursor];

            if (!await step.shouldExecute(context)) {
                cursor++;
                continue;
            }

            await step.execute(context);

            // Insert dynamically added sub-steps immediately after current
            const subSteps = step.getSubExecuteSteps(context);
            if (subSteps.length > 0) {
                this.executeSteps.splice(cursor + 1, 0, ...subSteps);
            }

            cursor++;
        }
    }
}
