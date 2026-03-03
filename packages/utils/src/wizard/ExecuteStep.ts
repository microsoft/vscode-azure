/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A single execute step in a {@link Wizard}.
 *
 * Execute steps run after all prompt steps have completed, in the
 * order they were registered. Dynamically added steps (via
 * {@link getSubExecuteSteps}) run immediately after their parent.
 *
 * @typeParam TContext - The shared wizard context type.
 */
export abstract class ExecuteStep<TContext> {
    /**
     * Perform the operation using the fully-populated context.
     * Modifying the {@link context} is allowed. // TODO: should we allow it? Or change to be consistent with `PromptStep`?
     */
    public abstract execute(context: TContext): void | Promise<void>;

    /**
     * Return `false` to skip this step. Defaults to `true` when not
     * overridden.
     */
    public shouldExecute(_context: Readonly<TContext>): boolean | Promise<boolean> {
        return true;
    }

    /**
     * Return additional execute steps to insert immediately after
     * this step. Called after {@link execute} completes successfully.
     * Defaults to none when not overridden.
     */
    public getSubExecuteSteps(_context: Readonly<TContext>): readonly ExecuteStep<TContext>[] {
        return [];
    }
}
