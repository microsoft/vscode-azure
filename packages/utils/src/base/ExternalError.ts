/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A user-actionable error that should be shown without offering to report an
 * issue with the extension. It is still logged and recorded as a failure.
 */
export class ExternalError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'ExternalError';
    }
}
