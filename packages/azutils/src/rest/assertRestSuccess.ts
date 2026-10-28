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
 *
 * The only body content kept is the short, identifier-shaped `code` values of a
 * service error's nested `error`/`innererror` chain, so a rejection can be told
 * apart without quoting any message, which may include request text.
 */
export function assertRestSuccess(code: IVsCode, response: HttpResponse): void {
    const status = Number(response.status);
    if (!(status >= 200 && status < 300)) {
        const codes = errorCodes(response.body);
        throw new RestError(codes.length
            ? code.l10n.t('The service request failed (HTTP {0}: {1}).', response.status, codes.join(', '))
            : code.l10n.t('The service request failed (HTTP {0}).', response.status), {
            statusCode: status,
        });
    }
}

function errorCodes(body: unknown): string[] {
    const codes: string[] = [];
    let current: unknown = body && typeof body === 'object' && 'error' in body ? body.error : undefined;
    while (current && typeof current === 'object' && codes.length < 5) {
        if ('code' in current && typeof current.code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(current.code)) {
            codes.push(current.code);
        }

        current = 'innererror' in current ? current.innererror : undefined;
    }

    return codes;
}
