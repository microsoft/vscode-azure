/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProcessExecutor, stringifyError } from '@microsoft/vscode-azure-utils';
import * as vscode from 'vscode';

/**
 * End-to-end (E2E) test support: configuration and suite gating.
 *
 * E2E tests make **real network calls** against a live Azure subscription and
 * create/destroy real resources. They are therefore long-running and disabled
 * by default. They run only when `RUN_E2E=1` is set in the environment (the
 * `Extension: Run E2E Tests` launch config sets this, and CI sets it on the
 * E2E job). When the flag is unset, {@linkcode describeE2E} registers the suite
 * as skipped so the files remain harmless in the normal `*.test.ts` collection.
 *
 * The real Azure credential injected into the live extension for these tests
 * lives in `src/override/e2e.ts` (the override bundle).
 *
 * @remarks
 * The default test runner glob also matches the `*.e2e.test.ts` files, so the
 * {@linkcode describeE2E} gate is the safety mechanism that prevents accidental
 * live runs during the normal test suite.
 */

/** Mocha timeout for E2E suites; live provisioning/deploys can take many minutes. */
const E2ETimeoutMs = 30 * 60 * 1000;

/**
 * Registers an E2E test suite.
 *
 * When E2E is enabled, this is a normal {@linkcode describe} block (with an
 * `(e2e)` label appended, mirroring the repo's `(unit)`/`(integration)` suffix
 * style) and a long mocha timeout to accommodate real Azure
 * provisioning/deployment. When disabled, the suite is registered with
 * {@linkcode describe.skip} so it never executes but still shows up as pending
 * in reporters.
 *
 * @param title - The suite title (the `(e2e)` label is appended automatically).
 * @param fn - The suite body.
 */
export function describeE2E(title: string, fn: (this: Mocha.Suite) => void) {
    const label = `${title} (e2e)`;
    if (process.env.RUN_E2E !== '1') {
        return describe.skip(label, fn);
    }

    return describe(label, function (this: Mocha.Suite) {
        this.timeout(E2ETimeoutMs);
        fn.call(this);
    });
}

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
                command: 'az',
                args: ['account', 'show', '-o', 'json'],
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
