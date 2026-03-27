/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PromptStep } from '../../wizard/PromptStep';
import { type FilteredChild, type GenericPickOptions, GenericPickStep } from './GenericPickStep';
import { getLastPick, type PickContext } from './PickContext';

export class RecursivePickStep<TItem, TOptions extends GenericPickOptions<TItem>> extends GenericPickStep<TItem, TOptions> {
    /**
     * @param options - Pick options (tree, classify, etc.)
     * @param recursiveClass - Constructor for the next recursive step.
     *   Defaults to {@linkcode RecursivePickStep}. Subclasses pass
     *   their own class so recursion creates the correct type.
     */
    public constructor(
        options: TOptions,
        private readonly recursiveClass: new (options: TOptions) => RecursivePickStep<TItem, TOptions> = RecursivePickStep,
    ) {
        super(options);
    }

    public override getSubPromptSteps(context: Readonly<PickContext<TItem>>): PromptStep<PickContext<TItem>>[] {
        if (context.selectedTerminalPicks?.length) {
            // If this is set, it means the user made a multi-pick selection, which can only happen if all of the items were terminal
            // Consequently, we know we're done and don't need to show any more prompts
            return [];
        }

        const lastPick = getLastPick<TItem, FilteredChild<TItem>>(context);
        if (!lastPick || lastPick.isTerminal) {
            return [];
        }

        return [new this.recursiveClass(this.options)];
    }
}
