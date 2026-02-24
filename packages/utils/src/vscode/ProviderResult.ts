/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { AssertAssignable } from '../types/AssertAssignable';

export type ProviderResult<T> = T | undefined | null | Promise<T | undefined | null>;

// Compile-time type checks
/* eslint-disable @typescript-eslint/no-unused-vars */
type ForwardCheckProviderResult = AssertAssignable<ProviderResult<unknown>, vscode.ProviderResult<unknown>>;
type ReverseCheckProviderResult = AssertAssignable<vscode.ProviderResult<unknown>, ProviderResult<unknown>>;
/* eslint-enable @typescript-eslint/no-unused-vars */
