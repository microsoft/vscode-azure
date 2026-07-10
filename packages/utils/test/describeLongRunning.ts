/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Name of the environment variable that opts long-running suites in.
 *
 * A suite registered with {@linkcode describeLongRunning} executes only when
 * this variable is set to `1`; otherwise it is registered as skipped. It is not
 * consumed anywhere else, so it is safe to set for the sole purpose of enabling
 * these suites locally.
 */
export const EnableLongRunningTestsEnvVar = 'ENABLE_LONG_RUNNING_TESTS';

/** Per-suite options controlling how a long-running suite runs once enabled. */
export interface LongRunningTestOptions {
    /**
     * Mocha timeout (in ms) applied to the suite. Long-running suites can take
     * far longer than the default mocha timeout, so callers that need more time
     * (e.g. live provisioning/deployment) should set this. When omitted, the
     * ambient mocha timeout is left unchanged.
     */
    readonly timeoutMs?: number;
}

/**
 * Registers a long-running test suite that is disabled by default.
 *
 * Long-running suites -- cross-store fuzzing, live end-to-end provisioning, and
 * the like -- are too slow to run on every `pnpm test`, so they are gated behind
 * the {@linkcode EnableLongRunningTestsEnvVar} environment variable. When it is
 * not set to `1`, the suite is registered with {@linkcode describe.skip} so it
 * stays visible as pending in reporters but never executes. When it is set, the
 * suite runs as a normal {@linkcode describe} block with a `(long-running)`
 * label appended (mirroring the repo's `(unit)`/`(integration)` suffix
 * convention) and the optional {@linkcode LongRunningTestOptions.timeoutMs}
 * applied.
 *
 * @param title - The suite title; the `(long-running)` label is appended automatically.
 * @param fn - The suite body. Use a `function` expression (not an arrow) if it needs `this`.
 * @param options - Optional per-suite configuration such as a longer timeout.
 */
export function describeLongRunning(title: string, fn: (this: Mocha.Suite) => void, options?: LongRunningTestOptions) {
    const label = `${title} (long-running)`;
    if (process.env[EnableLongRunningTestsEnvVar] !== '1') {
        return describe.skip(label, fn);
    }

    return describe(label, function (this: Mocha.Suite) {
        if (options?.timeoutMs !== undefined) {
            this.timeout(options.timeoutMs);
        }
        fn.call(this);
    });
}
