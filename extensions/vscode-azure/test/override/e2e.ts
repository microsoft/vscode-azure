/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Container overrides for the "azd up" E2E test.
//
// This is the credential-injection half of the E2E mechanism. When
// `ENABLE_LONG_RUNNING_TESTS=1` (set by the `Extension: Run E2E Tests` launch
// config and by CI), `main.js` loads this bundle and calls `applyOverrides` to
// rebind the credential factory to a real Azure `TokenCredential`, so the live
// extension authenticates against a real subscription instead of prompting for
// an interactive VS Code sign-in. The suite-gating half uses the shared
// `describeLongRunning` helper from `@microsoft/vscode-azure-utils/testing`.
//
// Compiled as a SEPARATE esbuild entry point (e2e.bundle.js) so none of this
// code -- nor its `@azure/identity` dependency -- ends up in the main extension
// bundle. It mirrors the debug mock-data bundle pattern and exposes the same
// `applyOverrides(container)` contract.

import { AzureCliCredential, AzurePipelinesCredential } from '@azure/identity';
import { ICredentialFactory, type TokenCredential } from '@microsoft/vscode-azure-azutils';
import type { Container } from 'inversify';

/**
 * Rebinds {@linkcode ICredentialFactory} to a real Azure
 * {@linkcode TokenCredential} so the in-process `AzdAuthServer` can mint live
 * tokens without an interactive VS Code sign-in.
 *
 * Called from `main.js` after `setUpContainer` but before activation when
 * `ENABLE_LONG_RUNNING_TESTS=1`. A single credential instance is shared across all factory calls
 * (the input subscription/tenant is ignored) so token caching is preserved.
 *
 * The credential is selected from the environment:
 * - In Azure Pipelines (CI), when the federated service-connection variables
 *   are present, an {@linkcode AzurePipelinesCredential} is used (federated,
 *   secret-less). These variables are set by the shared `vscode-azuretools`
 *   pipeline template's test step:
 *   `FC_SERVICE_CONNECTION_TENANT_ID`, `FC_SERVICE_CONNECTION_CLIENT_ID`,
 *   `FC_SERVICE_CONNECTION_ID`, and `SYSTEM_ACCESSTOKEN`.
 * - Otherwise (local development), a {@linkcode AzureCliCredential} is used,
 *   which picks up `az login`.
 *
 * @param container - The DI container to mutate.
 */
export function applyOverrides(container: Container): void {
    const tenantId = process.env.FC_SERVICE_CONNECTION_TENANT_ID;
    const clientId = process.env.FC_SERVICE_CONNECTION_CLIENT_ID;
    const serviceConnectionId = process.env.FC_SERVICE_CONNECTION_ID;
    const systemAccessToken = process.env.SYSTEM_ACCESSTOKEN;

    const credential: TokenCredential = tenantId && clientId && serviceConnectionId && systemAccessToken
        ? new AzurePipelinesCredential(tenantId, clientId, serviceConnectionId, systemAccessToken)
        : new AzureCliCredential();

    container.rebind(ICredentialFactory).toConstantValue(() => credential);
}
