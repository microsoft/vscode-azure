/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Yields to the event loop until {@linkcode condition} holds.
 *
 * For work that completes on its own but not synchronously -- a promise chain
 * the test cannot await directly, or a listener the code under test attaches
 * later. Prefer awaiting the operation itself whenever it is reachable.
 *
 * @param condition - Polled between turns; waiting ends as soon as it is true.
 * @param description - Named in the timeout message to identify the wait.
 * @param timeoutMs - How long to keep polling before giving up.
 * @throws When {@linkcode condition} has not held within {@linkcode timeoutMs},
 *   so a test that would otherwise hang fails with a useful message instead.
 */
export async function waitFor(
    condition: () => boolean,
    description = 'the expected state',
    timeoutMs = 1000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition() && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 1));
    }

    if (!condition()) {
        throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}.`);
    }
}
