/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';

export const IBar: ServiceIdentifier<IBar> = Symbol.for('IBar');
export interface IBar {
    doSomethingBarrish(): void;
}

export class DefaultBar implements IBar {
    constructor() {
        console.log('Building a DefaultBar!');
    }

    doSomethingBarrish(): void {
        console.log('DefaultBar is doing something barrish!');
    }
}

export const IFoo: ServiceIdentifier<IFoo> = Symbol.for('IFoo');
export interface IFoo {
    doSomethingFoolish(): void;
}

export class DefaultFoo implements IFoo {
    constructor(private readonly bar: IBar) {
        console.log('Building a DefaultFoo!');
    }

    doSomethingFoolish(): void {
        console.log(`${this.constructor.name} is doing something foolish!`);
        this.bar.doSomethingBarrish();
    }
}
