/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import type { IActionContext } from '../base/IActionContext';
import type { ActionCallback, IActionExecutor } from '../base/IActionExecutor';
import type { IVsCode } from '../base/IVsCode';

export const ICommandRegistry: ServiceIdentifier<ICommandRegistry> = Symbol.for('ICommandRegistry');
export interface ICommandRegistry extends vscode.Disposable {
    registerCommand<T = unknown>(commandId: string, callback: ActionCallback<T>): void;
}

export class CommandRegistry implements ICommandRegistry {
    private readonly disposables: vscode.Disposable[] = [];
    public constructor(
        private readonly actionExecutor: IActionExecutor,
        private readonly code: IVsCode
    ) {
    }

    public registerCommand<T = unknown>(commandId: string, callback: ActionCallback<T>): void {
        this.disposables.push(
            this.code.commands.registerCommand(commandId, (...args: unknown[]) => {
                return this.actionExecutor.callWithTelemetryAndErrorHandling(commandId, (context: IActionContext) => callback(context, ...args));
            })
        );
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}
