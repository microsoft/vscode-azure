/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';

export const IVsCode: ServiceIdentifier<IVsCode> = Symbol.for('IVsCode');
/**
 * The `vscode` module namespace, exposed as a DI service so tests can
 * substitute a mock. Prefer this over importing `vscode` directly in
 * product code.
 */
export type IVsCode = typeof vscode;

export const IExtensionContext: ServiceIdentifier<IExtensionContext> = Symbol.for('IExtensionContext');
/** The activating extension's `ExtensionContext`. */
export type IExtensionContext = vscode.ExtensionContext;

export const ICodeContext: ServiceIdentifier<ICodeContext> = Symbol.for('ICodeContext');
/** Bundle of the two most common VS Code dependencies, passed together for convenience. */
export type ICodeContext = {
    readonly code: IVsCode;
    readonly extensionContext: IExtensionContext;
};

/** Instance type of `vscode.TreeItem`, derived without a value-side import. */
export type ITreeItem = InstanceType<IVsCode['TreeItem']>;
