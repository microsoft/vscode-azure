/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PromptStep } from '../../wizard/PromptStep';
import { type FilteredChild, GenericPickStep } from './GenericPickStep';
import { getLastPick, type PickContext } from './PickContext';

export class RecursivePickStep<TItem> extends GenericPickStep<TItem> {
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

        return [new RecursivePickStep<TItem>(this.options)];
    }
}
