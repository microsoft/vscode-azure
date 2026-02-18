/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Foo } from '@microsoft/vscode-azure-utils';
import { Container, inject, injectable } from 'inversify';
import * as vscode from 'vscode';
import { IBar } from './IBar';

export async function activateInternal(ctx: vscode.ExtensionContext, perfStats: { loadStartTime: number, loadEndTime: number }): Promise<void> {
    const foo = new Foo('hello');
    foo.doSomething();

    const container = new Container();
    container.bind(IBar).to(Bar);
    container.bind(Baz).toSelf();

    container.get(Baz).doBazThings();

    // Output of the above:
    //
    // Foo is doing something with hello!
    // Bar is doing something!
    // Baz is doing baz things!

    await Promise.resolve();
}

export async function deactivateInternal(): Promise<void> {
    await Promise.resolve();
}

@injectable()
class Bar implements IBar {
    doSomething(): void {
        console.log('Bar is doing something!');
    }
}

@injectable()
class Baz {
    constructor(@inject(IBar) private readonly bar: IBar) {
        this.bar.doSomething();
    }

    public doBazThings(): void {
        console.log('Baz is doing baz things!');
    }
}
