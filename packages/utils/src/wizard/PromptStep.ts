/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ProviderResult } from '../vscode/ProviderResult';

/**
 * A single prompt step in a {@linkcode Wizard}.
 *
 * Each step gathers one piece of information from the user and returns
 * a partial context object with the properties it wants to set. The
 * wizard merges these partials into the accumulated context.
 *
 * Back navigation is handled automatically: when the user goes back
 * past this step, its contribution is simply removed and the context
 * is rebuilt from the remaining layers. Any dynamically added child
 * prompt steps are also removed.
 *
 * Steps may dynamically add further prompt steps by overriding
 * {@linkcode getSubPromptSteps}.
 *
 * @typeParam TContext - The shared wizard context type.
 */
export abstract class PromptStep<TContext> {
    /**
     * Prompt the user and return the properties to merge into the
     * wizard context.
     *
     * Throw {@linkcode GoBackError} to navigate back to the previous step,
     * or throw {@linkcode CancellationError} to abort the wizard entirely.
     *
     * @param context - The accumulated context so far (read-only view).
     * @returns A partial context to merge, or `undefined` if this
     *   step has nothing to add.
     */
    public abstract prompt(
        context: Readonly<TContext>,
    ): ProviderResult<Partial<TContext>>;

    /**
     * Return `false` to skip this step (e.g. when the context already
     * has the needed value). Defaults to `true` when not overridden.
     * @note - Whenever possible, this should be synchronous and fast. It is better
     *   to return `true` and let the step's {@linkcode prompt} method noop,
     *   if slow work is required.
     */
    public shouldPrompt(_context: Readonly<TContext>): boolean | Promise<boolean> {
        return true;
    }

    /**
     * Return additional prompt steps to insert immediately after this
     * step. Called after {@linkcode prompt} completes successfully.
     * Defaults to none when not overridden.
     */
    public getSubPromptSteps(_context: Readonly<TContext>): PromptStep<TContext>[] {
        return [];
    }
}
