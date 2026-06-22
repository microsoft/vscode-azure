/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * End-to-end (E2E) test support: configuration and suite gating.
 *
 * E2E tests make **real network calls** against a live Azure subscription and
 * create/destroy real resources. They are therefore long-running and disabled
 * by default. They run only when `RUN_E2E=1` is set in the environment (the
 * `Extension: Run E2E Tests` launch config sets this, and CI sets it on the
 * E2E job). When the flag is unset, {@linkcode describeE2e} registers the suite
 * as skipped so the files remain harmless in the normal `*.test.ts` collection.
 *
 * The real Azure credential injected into the live extension for these tests
 * lives in `src/debug/e2e.ts` (the override bundle).
 *
 * @remarks
 * Because `@vscode/test-cli`'s default glob (`src/test/** /*.test.ts`) also
 * matches `*.e2e.test.ts`, the {@linkcode describeE2e} gate is the safety
 * mechanism that prevents accidental live runs during the normal test suite.
 */


/** Mocha timeout for E2E suites; live provisioning/deploys can take many minutes. */
const E2eTimeoutMs = 30 * 60 * 1000;

/**
 * Registers an E2E test suite.
 *
 * When E2E is enabled, this is a normal {@linkcode describe} block (with an
 * `(e2e)` label appended per the repo's labeling convention) and a long mocha
 * timeout to accommodate real Azure provisioning/deployment. When disabled,
 * the suite is registered with {@linkcode describe.skip} so it never executes
 * but still shows up as pending in reporters.
 *
 * @param title - The suite title (the `(e2e)` label is appended automatically).
 * @param fn - The suite body.
 */
export function describeE2e(title: string, fn: (this: Mocha.Suite) => void) {
    const label = `${title} (e2e)`;
    if (process.env.RUN_E2E !== '1') {
        return describe.skip(label, fn);
    }
    return describe(label, function (this: Mocha.Suite) {
        this.timeout(E2eTimeoutMs);
        fn.call(this);
    });
}

/**
 * Resolved configuration for an E2E run, sourced from environment variables.
 */
export interface E2eConfig {
    /** Target subscription ID (`AZURE_E2E_SUBSCRIPTION_ID`). */
    readonly subscriptionId: string;
    /** Owning tenant ID (`AZURE_E2E_TENANT_ID`). */
    readonly tenantId: string;
    /** Azure region for created resources (`AZURE_E2E_LOCATION`, default `eastus`). */
    readonly location: string;
}

/** Reads a required environment variable, throwing a descriptive error if missing. */
function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `E2E tests require the ${name} environment variable to be set. ` +
            `Set RUN_E2E=1 and the AZURE_E2E_* variables (see src/test/e2e/README.md).`,
        );
    }
    return value;
}

/**
 * Resolve the {@linkcode E2eConfig} from the environment.
 *
 * Only call this from inside an enabled E2E suite (it throws when required
 * variables are missing). Required: `AZURE_E2E_SUBSCRIPTION_ID`,
 * `AZURE_E2E_TENANT_ID`.
 */
export function getE2eConfig(): E2eConfig {
    return {
        subscriptionId: requireEnv('AZURE_E2E_SUBSCRIPTION_ID'),
        tenantId: requireEnv('AZURE_E2E_TENANT_ID'),
        location: process.env.AZURE_E2E_LOCATION || 'eastus',
    };
}
