/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ServiceIdentifier } from 'inversify';

export const IBar: ServiceIdentifier<IBar> = Symbol.for('IBar');
export interface IBar {
    doSomething(): void;
}
