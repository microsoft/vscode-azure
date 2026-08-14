/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    IActionExecutor, IVsCode,
} from '@microsoft/vscode-azure-utils';
import type { Container } from 'inversify';
import type { ProductRegistrar } from '../registration/ProductRegistrar';
import { pushDisposable } from '../services';
import { IWorkspaceDataService, WorkspaceDataService } from './WorkspaceDataService';

/**
 * Bind the shared workspace index.
 *
 * Detectors are contributed by products, in product registration order, which
 * determines the order of tags within an entry.
 *
 * The service is a singleton: its whole purpose is that one scan of the
 * workspace serves every consumer.
 */
export function registerWorkspaceData(container: Container, products: ProductRegistrar): void {
    container.bind(IWorkspaceDataService).toDynamicValue(context => {
        return new WorkspaceDataService(
            context.get(IVsCode),
            context.get(IActionExecutor),
            products.getWorkspaceDetectors(),
        );
    }).inSingletonScope().onActivation(pushDisposable);
}
