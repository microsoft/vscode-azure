/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { HttpResponse } from '@azure-rest/core-client';
import { RestError } from '@azure/core-rest-pipeline';
import type { IVsCode } from '@microsoft/vscode-azure-utils';

/**
 * Rejects non-2xx data-plane statuses without copying response bodies,
 * request URLs, or credentials into the error that telemetry records.
 */
export function assertRestSuccess(code: IVsCode, response: HttpResponse): void {
    const status = Number(response.status);
    if (!(status >= 200 && status < 300)) {
        throw new RestError(code.l10n.t('The service request failed (HTTP {0}).', response.status), {
            statusCode: status,
        });
    }
}
