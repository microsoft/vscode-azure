/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { command, ProcessExecutor, stringifyError } from '@microsoft/vscode-azure-utils';
import * as vscode from 'vscode';

/**
 * End-to-end (E2E) test configuration.
 *
 * E2E tests make **real network calls** against a live Azure subscription and
 * create/destroy real resources. They are therefore long-running and disabled
 * by default, gated behind `ENABLE_LONG_RUNNING_TESTS=1` via the shared
 * `describeLongRunning` helper from `@microsoft/vscode-azure-utils/testing` (the
 * `Extension: Run E2E Tests` launch config sets the flag, and CI sets it on the
 * E2E job). The default test runner glob also matches the `*.e2e.test.ts` files,
 * so that gate is the safety mechanism that prevents accidental live runs during
 * the normal test suite.
 *
 * This module resolves the {@linkcode E2EConfig} (subscription/tenant/location)
 * for a run. The real Azure credential injected into the live extension for
 * these tests lives in `test/override/e2e.ts` (the override bundle), also gated
 * on `ENABLE_LONG_RUNNING_TESTS=1`.
 */

/** Mocha timeout for E2E suites; live provisioning/deploys can take many minutes. */
export const E2ETimeoutMs = 30 * 60 * 1000;

/**
 * Resolved configuration for an E2E run.
 *
 * Values are sourced from environment variables when present (the CI path:
 * `AZURE_E2E_*` and the `FC_SERVICE_CONNECTION_*` federated-connection vars).
 * For local development, the subscription and tenant fall back to whatever the
 * Azure CLI (`az`) is currently logged into, matching the
 * {@linkcode AzureCliCredential} used by the E2E credential override.
 */
export interface E2EConfig {
    /** Target subscription ID (`AZURE_E2E_SUBSCRIPTION_ID`, else the `az` active subscription). */
    readonly subscriptionId: string;
    /** Owning tenant ID (`FC_SERVICE_CONNECTION_TENANT_ID`/`AZURE_E2E_TENANT_ID`, else the `az` active tenant). */
    readonly tenantId: string;
    /** Azure region for created resources (`AZURE_E2E_LOCATION`, default `westus2`). */
    readonly location: string;
}

/** Subset of `az account show -o json` output that we consume. */
interface AzAccount {
    readonly id: string;
    readonly tenantId: string;
}

/**
 * The active Azure CLI account, fetched at most once for the life of the test
 * process and memoized (including a rejected promise, so a missing/failed `az`
 * fails fast on every subsequent call rather than re-shelling out).
 */
let azAccountPromise: Promise<AzAccount> | undefined;

/**
 * Resolve the active Azure CLI account via `az account show -o json`.
 *
 * The result is cached for the life of the process. Rejects if the `az` CLI is
 * not installed, the user is not logged in (`az login`), or the output cannot
 * be parsed.
 */
function getAzAccount(): Promise<AzAccount> {
    azAccountPromise ??= (async () => {
        const executor = new ProcessExecutor(vscode);
        let account: AzAccount;
        try {
            const result = await executor.spawn<AzAccount>({
                execution: 'background',
                command: command('az').arg('account', 'show').namedArg('-o', 'json'),
                parseJson: true,
                // The Azure CLI is an `az.cmd` shim on Windows, which must be
                // launched through a shell (spawning it directly fails EINVAL).
                shell: process.platform === 'win32',
            });
            account = result.json;
        } catch (error) {
            throw new Error(
                `Failed to run 'az account show'. Ensure the Azure CLI is installed and 'az login' has been run. ${stringifyError(error)}`,
                { cause: error },
            );
        }

        if (!account.id || !account.tenantId) {
            throw new Error("'az account show' did not return a subscription id and tenant id. Run 'az login' and select a subscription.");
        }

        return { id: account.id, tenantId: account.tenantId };
    })();

    return azAccountPromise;
}

/**
 * Resolve the {@linkcode E2EConfig} for the current run.
 *
 * Only call this from inside an enabled E2E suite. Resolution order:
 * - `subscriptionId`: `AZURE_E2E_SUBSCRIPTION_ID`, else the active `az` subscription.
 * - `tenantId`: `FC_SERVICE_CONNECTION_TENANT_ID`, else `AZURE_E2E_TENANT_ID`,
 *   else the active `az` tenant.
 * - `location`: `AZURE_E2E_LOCATION`, else `westus2`.
 *
 * The Azure CLI is only consulted when one of the above env vars is missing, so
 * the CI path (which sets them) never shells out to `az`. When it is consulted,
 * `az account show` runs at most once per process (see {@linkcode getAzAccount}).
 *
 * @throws If a value must come from `az` but the CLI is missing, not logged in,
 *   or returns unparseable output.
 */
export async function getE2EConfig(): Promise<E2EConfig> {
    const subscriptionId = process.env.AZURE_E2E_SUBSCRIPTION_ID;
    const tenantId = process.env.FC_SERVICE_CONNECTION_TENANT_ID || process.env.AZURE_E2E_TENANT_ID;

    const account = subscriptionId && tenantId ? undefined : await getAzAccount();

    return {
        subscriptionId: subscriptionId || account!.id, // eslint-disable-line @typescript-eslint/no-non-null-assertion -- account is resolved whenever subscriptionId is missing
        tenantId: tenantId || account!.tenantId, // eslint-disable-line @typescript-eslint/no-non-null-assertion -- account is resolved whenever tenantId is missing
        location: process.env.AZURE_E2E_LOCATION || 'westus2',
    };
}
