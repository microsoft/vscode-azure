/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Marker interface for command classes registered via
 * {@linkcode registerManagedCommand}. Each implementation is constructed
 * per-invocation with an `IActionContext` bound in a child container,
 * and its {@linkcode ManagedCommand.execute} method is called with any
 * prefix args followed by the args from VS Code.
 */
export interface ManagedCommand<T = unknown> {
    execute(...args: unknown[]): T | Promise<T>;
}
