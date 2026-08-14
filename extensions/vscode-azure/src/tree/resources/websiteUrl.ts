/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebsiteUrl } from '../../constants';

/**
 * Attaches a browsable website URL to a resource, in place.
 *
 * Intended to be called from a data provider's `enrich` implementation, which
 * mutates the resource without replacing it. Normalization happens here so
 * every provider contributes a consistent, browser-safe URL: ARM reports bare
 * hostnames, so a value without a scheme is assumed to be HTTPS, and anything
 * that is not HTTP(S) is discarded.
 *
 * @param endpoint - The endpoint reported by the product API, if any. When it
 *   is missing or unusable, no property is attached.
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

    try {
        const url = new URL(value.includes('://') ? value : `https://${value}`);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
    } catch {
        return undefined;
    }
}
