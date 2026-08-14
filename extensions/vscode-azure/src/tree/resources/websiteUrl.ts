/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebsiteUrl } from '../../constants';

/** Matches the only schemes a website URL is allowed to carry. */
const HttpSchemePattern = /^https?:\/\//i;

/**
 * Attaches a browsable website URL to a resource, in place.
 *
 * Intended to be called from a data provider's `enrich` implementation, which
 * mutates the resource without replacing it. Normalization happens here so
 * every provider contributes a consistent, browser-safe URL.
 *
 * @param endpoint - A bare hostname (as ARM reports it) or an absolute
 *   `http(s)` URL. When it is missing, or carries any other scheme, no
 *   property is attached.
 */
export function setWebsiteUrl(resource: object, endpoint: string | undefined): void {
    const url = normalizeEndpoint(endpoint);
    if (url) {
        Object.assign(resource, { [WebsiteUrl]: url });
    }
}

/**
 * Returns the website URL previously attached by {@linkcode setWebsiteUrl}.
 *
 * Returns `undefined` for resources that have no website, and for resources
 * whose enrichment has not run yet.
 */
export function getWebsiteUrl(resource: unknown): string | undefined {
    if (!resource || typeof resource !== 'object') {
        return undefined;
    }

    const url = (resource as Record<symbol, unknown>)[WebsiteUrl];
    return typeof url === 'string' ? url : undefined;
}

function normalizeEndpoint(endpoint: string | undefined): string | undefined {
    const value = endpoint?.trim();
    if (!value) {
        return undefined;
    }

    // ARM reports bare hostnames (`contoso.azurewebsites.net`), so a value with
    // no scheme is assumed to be HTTPS. A value that carries any other scheme is
    // rejected outright rather than coerced, so nothing but http(s) can reach a
    // browser -- which also makes the parse below http(s) by construction.
    if (value.includes(':') && !HttpSchemePattern.test(value)) {
        return undefined;
    }

    try {
        return new URL(HttpSchemePattern.test(value) ? value : `https://${value}`).toString();
    } catch {
        return undefined;
    }
}
