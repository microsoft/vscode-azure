/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';
import type { IActionContext } from '../base/IActionContext';
import type { ActionCallback, IActionExecutor } from '../base/IActionExecutor';
import { Disposable } from '../vscode/Disposable';
import type { IVsCode } from '../vscode/IVsCode';

export const ICommandRegistry: ServiceIdentifier<ICommandRegistry> = Symbol.for('ICommandRegistry');

/**
 * Registers VS Code commands whose handlers run inside an
 * {@linkcode IActionContext} via {@linkcode IActionExecutor}.
 *
 * Disposing the registry unregisters every command it has registered.
 */
export interface ICommandRegistry extends Disposable {
    /**
     * Register a VS Code command. The `callback` is invoked via
     * {@linkcode IActionExecutor.callWithTelemetryAndErrorHandling}
     * so it receives a fresh {@linkcode IActionContext} and has its
     * telemetry and errors handled automatically.
     */
    registerCommand<T = unknown>(commandId: string, callback: ActionCallback<T>): void;
}

/** Default {@linkcode ICommandRegistry} implementation that delegates to VS Code's command API. */
export class CommandRegistry implements ICommandRegistry {
    private readonly disposables: Disposable[] = [];
    public constructor(
        private readonly actionExecutor: IActionExecutor,
        private readonly code: IVsCode
    ) {
    }

    /** @inheritdoc */
    public registerCommand<T = unknown>(commandId: string, callback: ActionCallback<T>): void {
        this.disposables.push(
            this.code.commands.registerCommand(commandId, (...args: unknown[]) => {
                return this.actionExecutor.callWithTelemetryAndErrorHandling(commandId, (context: IActionContext) => callback(context, ...args));
            })
        );
    }

    /** @inheritdoc */
    public dispose(): void {
        Disposable.disposeAll(this.disposables);
    }
}
