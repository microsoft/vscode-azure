/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A single execute step in a {@linkcode Wizard}.
 *
 * Execute steps run after all prompt steps have completed, in the
 * order they were registered. Dynamically added steps (via
 * {@linkcode getSubExecuteSteps}) run immediately after their parent.
 *
 * @typeParam TContext - The shared wizard context type.
 */
export abstract class ExecuteStep<TContext> {
    /**
     * Perform the operation using the fully-populated context.
     *
     * @param context - The fully-populated wizard context (read-only view,
     *   for symmetry with {@linkcode PromptStep.prompt}).
     */
    public abstract execute(context: Readonly<TContext>): void | Promise<void>;

    /**
     * Return `false` to skip this step. Defaults to `true` when not
     * overridden.
     */
    public shouldExecute(_context: Readonly<TContext>): boolean | Promise<boolean> {
        return true;
    }

    /**
     * Return additional execute steps to insert immediately after
     * this step. Called after {@linkcode execute} completes successfully.
     * Defaults to none when not overridden.
     */
    public getSubExecuteSteps(_context: Readonly<TContext>): readonly ExecuteStep<TContext>[] {
        return [];
    }
}
