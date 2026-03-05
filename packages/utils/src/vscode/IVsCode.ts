/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';

export const IVsCode: ServiceIdentifier<IVsCode> = Symbol.for('IVsCode');
export type IVsCode = typeof vscode; // TODO: subset to what we actually use for easier mocking? Could use Pick<> for making that easy

export const IExtensionContext: ServiceIdentifier<IExtensionContext> = Symbol.for('IExtensionContext');
export type IExtensionContext = vscode.ExtensionContext;

export const ICodeContext: ServiceIdentifier<ICodeContext> = Symbol.for('ICodeContext');
export type ICodeContext = {
    readonly code: IVsCode;
    readonly extensionContext: IExtensionContext;
};

export type ITreeItem = InstanceType<IVsCode['TreeItem']>;
