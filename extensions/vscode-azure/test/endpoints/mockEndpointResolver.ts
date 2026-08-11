/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource } from '@microsoft/vscode-azure-azutils';
import { mock } from 'node:test';
import type { IResourceEndpointResolver } from '../../src/endpoints/ResourceEndpointResolver';

/**
 * Creates an {@linkcode IResourceEndpointResolver} for view-provider tests.
 *
 * View providers consult the resolver only to decide whether to add the Browse
 * Website context value, so `canHandle` controls whether that context value
 * appears and `resolve` is never expected to run during rendering.
 *
 * @param canHandle - Whether resources have a browsable endpoint, either as a
 *   fixed answer or as a predicate for tests that vary it by resource type.
 * @param endpoint - The endpoint returned by `resolve`, for the rare test that needs one.
 */
export function createMockEndpointResolver(
    canHandle: boolean | ((resource: GenericResource) => boolean),
    endpoint?: string,
): IResourceEndpointResolver {
    return {
        canHandle: mock.fn((resource: GenericResource) => typeof canHandle === 'boolean' ? canHandle : canHandle(resource)),
        resolve: mock.fn(() => Promise.resolve(endpoint)),
    };
}
