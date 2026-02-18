/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Test class to prove out imports from this package
 */
export class Foo {
    constructor(public bar: string) { }

    public doSomething(): void {
        console.log(`Foo is doing something with ${this.bar}!`);
    }
}
