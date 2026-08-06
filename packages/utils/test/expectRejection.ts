/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { stringifyError } from '../src/base/stringifyError';

/**
 * Assert that {@linkcode promise} rejects, and optionally that the error message matches.
 *
 * Replaces the `try { await ...; expect.fail(); } catch { ... }` shape, which is easy to write
 * subtly wrong -- most often by asserting inside the `try`, where a failed assertion is caught by
 * the very `catch` meant to inspect the rejection, and the test silently passes.
 *
 * @param promise - The promise expected to reject.
 * @param expected - Optional matcher for the error's message.
 * @returns the rejection reason, so callers can make further assertions on it.
 * @throws if the promise resolves, or if the message does not match {@linkcode expected}.
 */
export async function expectRejection(promise: Promise<unknown>, expected?: RegExp | string): Promise<unknown> {
    let reason: unknown;
    let rejected = false;

    try {
        await promise;
    } catch (error) {
        reason = error;
        rejected = true;
    }

    if (!rejected) {
        throw new Error('Expected the promise to reject, but it resolved.');
    }

    if (expected !== undefined) {
        const message = stringifyError(reason);
        const matches = typeof expected === 'string' ? message.includes(expected) : expected.test(message);

        if (!matches) {
            throw new Error(`Expected the rejection message to match ${String(expected)}, but got: ${message}`);
        }
    }

    return reason;
}
