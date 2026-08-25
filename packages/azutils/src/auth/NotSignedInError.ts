/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** The {@linkcode Error.name} carried by every {@linkcode NotSignedInError}. */
const NotSignedInErrorName = 'NotSignedInError';

/**
 * Thrown when an operation needs a token for an account or tenant that the user
 * has not signed in to, and acquiring one silently was not possible.
 *
 * This is deliberately a distinct type rather than a plain {@linkcode Error},
 * because it is the one listing failure that is *expected*. An account with
 * access to many tenants has typically signed in to a handful of them, so a walk
 * across every tenant is meant to encounter this and carry on. Reporting it the
 * way a genuine fault is reported -- a warning naming "unreachable" tenants --
 * would fire on a perfectly healthy setup and train the user to ignore it.
 *
 * Callers should distinguish it with {@linkcode isNotSignedInError} and offer
 * sign-in rather than reporting a failure.
 */
export class NotSignedInError extends Error {
    public constructor(message = 'Not signed in') {
        super(message);
        this.name = NotSignedInErrorName;
    }
}

/**
 * Whether `error` reports a missing sign-in rather than a fault.
 *
 * Matches on {@linkcode Error.name} rather than `instanceof` alone, so an error
 * that crossed a bundle boundary (where two copies of this class can exist)
 * still classifies correctly.
 */
export function isNotSignedInError(error: unknown): error is NotSignedInError {
    return error instanceof NotSignedInError
        || (error instanceof Error && error.name === NotSignedInErrorName);
}
