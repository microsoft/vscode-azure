/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebsiteUrl } from '../../constants';

/** Matches the only schemes a website URL is allowed to carry. */
const HttpSchemePattern = /^https?:\/\//i;

/**
 * Matches a leading URI scheme that is not http(s), so a foreign scheme can be
 * rejected without also rejecting a bare host that carries a port.
 *
 * A scheme and a `host:port` are genuinely ambiguous to a URL parser
 * (`contoso.example.com:8080` parses as scheme `contoso.example.com`), so the
 * colon must be followed by something other than a digit to count as a scheme.
 */
const ForeignSchemePattern = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

/**
 * Attaches a browsable website URL to a resource, in place, replacing any
 * previously attached URL.
 *
 * Intended to be called from a data provider's `enrich` implementation, which
 * mutates the resource without replacing it. Normalization happens here so
 * every provider contributes a consistent, browser-safe URL.
 *
 * Because enrichment re-runs against the same resource object, an endpoint that
 * is missing or unusable *removes* the property rather than leaving the previous
 * value in place: a resource that has stopped exposing a website must stop
 * advertising one, instead of keeping a URL that no longer resolves.
 *
 * @param endpoint - A bare host (as ARM reports it, optionally with a port and
 *   path) or an absolute `http(s)` URL. When it is missing, or carries any
 *   other scheme, no property is attached.
 */
export function setWebsiteUrl(resource: object, endpoint: string | undefined): void {
    const url = normalizeEndpoint(endpoint);
    if (url) {
        Object.assign(resource, { [WebsiteUrl]: url });
    } else {
        Reflect.deleteProperty(resource, WebsiteUrl);
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
    if (!HttpSchemePattern.test(value) && ForeignSchemePattern.test(value)) {
        return undefined;
    }

    try {
        return new URL(HttpSchemePattern.test(value) ? value : `https://${value}`).toString();
    } catch {
        return undefined;
    }
}
