/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ITreeItem } from '../../vscode/IVsCode';

export interface PickContext<T> {
    readonly picks: PickPair<T>[];
}

export interface PickPair<T> {
    readonly item: T;
    readonly treeItem: ITreeItem;
}


// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function getLastPick<T, TPair extends PickPair<T> = PickPair<T>>(context: Readonly<PickContext<T>>): TPair | undefined {
    const lastPick = context.picks.slice(-1)[0] as TPair | undefined;
    return lastPick;
}
