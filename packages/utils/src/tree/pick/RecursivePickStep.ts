/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptStep } from '../../wizard/PromptStep';
import { FilteredChild, GenericPickStep } from './GenericPickStep';
import { getLastPick, PickContext } from './PickContext';

export class RecursivePickStep<TItem> extends GenericPickStep<TItem> {
    public override getSubPromptSteps(context: Readonly<PickContext<TItem>>): PromptStep<PickContext<TItem>>[] {
        const lastPick = getLastPick<TItem, FilteredChild<TItem>>(context);

        if (!lastPick || lastPick.isTerminal) {
            return [];
        }

        return [new RecursivePickStep<TItem>(this.options)];
    }
}
