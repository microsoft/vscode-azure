/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Property key under which a data provider attaches a resource's browsable
 * website URL during enrichment.
 *
 * A symbol is used so the property cannot collide with an ARM property, and so
 * the capability can be detected exactly rather than by inspecting the resource
 * type. It is module-private: everything goes through the accessors below,
 * which keeps the stored shape an implementation detail.
 */
const WebsiteUrl = Symbol('vscode-azure.websiteUrl');

/**
 * Attaches a browsable website URL to a resource, in place, replacing any
 * previously attached URL.
 *
 * Intended to be called from a data provider's `enrich` implementation, which
 * mutates the resource without replacing it.
 *
 * Because enrichment re-runs against the same resource object, a missing
 * hostname *removes* the property rather than leaving the previous value in
 * place: a resource that has stopped exposing a website must stop advertising
 * one, instead of keeping a URL that no longer resolves.
 *
 * The result is not validated here. {@linkcode OpenUrl} checks the scheme of
 * every URL immediately before opening it, which is the point at which an
 * unsafe value would actually matter.
 *
 * @param hostname - The host ARM reports for the resource, without a scheme
 *   (for example `contoso.azurewebsites.net`). Pass `undefined` when the
 *   resource has no website.
 */
export function setWebsiteUrl(resource: object, hostname: string | undefined): void {
    const host = hostname?.trim();
    if (host) {
        Object.assign(resource, { [WebsiteUrl]: `https://${host}` });
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
