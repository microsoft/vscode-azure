/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ITreeItem } from '../../vscode/IVsCode';

export interface PickContext<T> {
    readonly picks?: PickPair<T>[];
    readonly selectedTerminalPicks?: T[];
}

export interface PickPair<T> {
    readonly item: T;
    readonly treeItem: ITreeItem;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function getLastPick<T, TPair extends PickPair<T> = PickPair<T>>(context: Readonly<PickContext<T>>): TPair | undefined {
    const picks = context.picks ?? [];
    const lastIndex: number = picks.length - 1;
    const lastPick = lastIndex >= 0 ? picks[lastIndex] as TPair : undefined;
    return lastPick;
}
