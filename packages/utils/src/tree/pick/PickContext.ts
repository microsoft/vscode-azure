/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ITreeItem } from '../../vscode/IVsCode';

/**
 * Wizard context accumulated by tree-pick prompt steps.
 *
 * Each step appends one entry to {@linkcode picks} as the user drills into
 * the tree. When a multi-select terminal pick is made, the chosen items
 * are placed in {@linkcode selectedTerminalPicks} instead and the wizard
 * completes.
 */
export interface PickContext<T> {
    /** The sequence of items the user has drilled into so far, from root to leaf. */
    readonly picks?: PickPair<T>[];
    /** Items selected from a multi-select terminal pick. Mutually exclusive with further drilling. */
    readonly selectedTerminalPicks?: T[];
}

/**
 * A single pick: the underlying tree item together with its display representation.
 */
export interface PickPair<T> {
    readonly item: T;
    readonly treeItem: ITreeItem;
}

/**
 * Return the most recent pick made by the user, or `undefined` if none yet.
 *
 * The optional type parameter `TPair` lets callers narrow the return type
 * when they know their picks carry richer metadata (e.g.
 * {@linkcode FilteredChild}).
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function getLastPick<T, TPair extends PickPair<T> = PickPair<T>>(context: Readonly<PickContext<T>>): TPair | undefined {
    const picks = context.picks ?? [];
    const lastIndex: number = picks.length - 1;
    const lastPick = lastIndex >= 0 ? picks[lastIndex] as TPair : undefined;
    return lastPick;
}
