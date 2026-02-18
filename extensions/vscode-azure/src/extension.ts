/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DefaultBar, DefaultFoo, IBar, IFoo } from '@microsoft/vscode-azure-utils';
import { Container, inject, injectable } from 'inversify';
import * as vscode from 'vscode';

export async function activateInternal(ctx: vscode.ExtensionContext, perfStats: { loadStartTime: number, loadEndTime: number }): Promise<void> {
    const container = new Container();
    container.bind(IBar).to(DefaultBar);

    container.bind(IFoo).toDynamicValue(context => {
        const bar = context.get(IBar);
        return new DefaultFoo(bar);
    });

    container.get(IFoo).doSomethingFoolish();

    // Output of the above:
    //
    // Building a DefaultBar!
    // Building a DefaultFoo!
    // DefaultFoo is doing something foolish!
    // DefaultBar is doing something barrish!

    // Another way to do it: subclassing DefaultFoo and using @injectable and @inject decorators
    container.unbindSync(IFoo);
    container.bind(IFoo).to(InjectableFoo);
    container.get(IFoo).doSomethingFoolish();

    // Output of the above:
    //
    // Building a DefaultBar!
    // Building an InjectableFoo!
    // Building a DefaultFoo! // (due to the call to super() in InjectableFoo's constructor)
    // InjectableFoo is doing something foolish! // (note the different class name due to using `this.constructor.name` in the log message)
    // DefaultBar is doing something barrish!

    await Promise.resolve();
}

export async function deactivateInternal(): Promise<void> {
    await Promise.resolve();
}

@injectable()
class InjectableFoo extends DefaultFoo {
    constructor(@inject(IBar) bar: IBar) {
        console.log('Building an InjectableFoo!');
        super(bar);
    }
}
