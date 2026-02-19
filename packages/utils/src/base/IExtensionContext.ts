/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';

export const IExtensionContext: ServiceIdentifier<IExtensionContext> = Symbol.for('IExtensionContext');
export type IExtensionContext = vscode.ExtensionContext; // TODO: subset to what we actually use for easier mocking?
