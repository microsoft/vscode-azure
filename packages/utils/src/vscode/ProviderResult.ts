/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { Satisfies } from '../types/Satisfies';

export type ProviderResult<T> = T | undefined | null | Promise<T | undefined | null>;

// Compile-time type checks
/* eslint-disable @typescript-eslint/no-unused-vars */
type ForwardCheckProviderResult = Satisfies<ProviderResult<unknown>, vscode.ProviderResult<unknown>>;
type ReverseCheckProviderResult = Satisfies<vscode.ProviderResult<unknown>, ProviderResult<unknown>>;
/* eslint-enable @typescript-eslint/no-unused-vars */
