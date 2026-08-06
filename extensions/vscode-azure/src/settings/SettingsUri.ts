/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getPortalHost, type VirtualResource } from '@microsoft/vscode-azure-azutils';
import type { IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

/** URI scheme under which settings documents are served. */
export const SettingsScheme = 'azure-settings';

/** Extension of a settings document. Selects the editor's `jsonc` language mode. */
const SettingsFileExtension = '.jsonc';

/** Separator between the parts packed into the identity segment. */
const IdentitySeparator = '|';

/**
 * The pieces of identity a settings document URI carries.
 *
 * Everything needed to re-resolve the owning resource from scratch is present, so a document
 * restored by the editor after a window reload resolves correctly even though no tree state exists
 * yet.
 */
export interface SettingsUriParts {
    readonly accountId: string;
    readonly portalHost: string;
    readonly tenantId: string;
    /** ARM id of the resource that owns the settings. */
    readonly armResourceId: string;
    /** Stable collection id, e.g. `appSettings`. */
    readonly collectionId: string;
}

/**
 * Encodes and decodes the `azure-settings:` URIs that address settings documents.
 *
 * The URI is deliberately **self-describing** rather than a handle into a session-scoped map: the
 * editor restores open editors on window reload and calls `readFile` before the extension has any
 * tree state, so a handle would dangle.
 *
 * Shape:
 * ```
 * azure-settings:/<identity>/<armResourceId>/<resourceName>.<collectionId>.jsonc
 * ```
 *
 * `<identity>` is a hex encoding of `accountId|portalHost|tenantId`.
 *
 * @remarks
 * The identity is packed into the **path**, never the authority. VS Code lowercases a URI's
 * authority when round-tripping through `Uri.parse(uri.toString())` but preserves the path
 * byte-for-byte, and account ids are not safe to lowercase. Hex is used rather than base64url for
 * the same reason: it survives case normalization regardless.
 */
export const SettingsUri = {
    /** Build the document URI for a settings collection virtual node. */
    from(code: IVsCode, node: VirtualResource): vscode.Uri {
        const resource = node.azureResource;

        return SettingsUri.fromParts(code, {
            accountId: resource.subscription.accountId,
            portalHost: getPortalHost(resource.subscription),
            tenantId: resource.subscription.tenantId,
            armResourceId: resource.id,
            collectionId: node.virtualPath,
        }, resource.name);
    },

    /** Build the document URI from raw parts and the display name used for the editor tab. */
    fromParts(code: IVsCode, parts: SettingsUriParts, resourceName: string): vscode.Uri {
        const identity = Buffer
            .from([parts.accountId, parts.portalHost, parts.tenantId].join(IdentitySeparator), 'utf8')
            .toString('hex');

        // `armResourceId` already starts with '/', so it splices in directly.
        const fileName = `${resourceName}.${parts.collectionId}${SettingsFileExtension}`;
        const path = `/${identity}${parts.armResourceId}/${fileName}`;

        return code.Uri.from({ scheme: SettingsScheme, path });
    },

    /**
     * Decode a settings document URI.
     *
     * @throws if the URI is not a well-formed settings document URI.
     */
    parse(uri: vscode.Uri): SettingsUriParts {
        if (uri.scheme !== SettingsScheme) {
            throw new Error(`Not a settings URI: expected scheme '${SettingsScheme}' but got '${uri.scheme}'`);
        }

        const segments = uri.path.split('/').filter(Boolean);
        if (segments.length < 3) {
            throw new Error(`Not a settings URI: '${uri.path}' is missing the identity, resource, or file name segment`);
        }

        const [identity, ...rest] = segments;
        const fileName = rest[rest.length - 1];
        const armResourceId = `/${rest.slice(0, -1).join('/')}`;

        const decoded = Buffer.from(identity, 'hex').toString('utf8');
        const [accountId, portalHost, tenantId] = decoded.split(IdentitySeparator);
        if (!accountId || !portalHost || !tenantId) {
            throw new Error('Not a settings URI: the identity segment is malformed');
        }

        if (!fileName.endsWith(SettingsFileExtension)) {
            throw new Error(`Not a settings URI: '${fileName}' does not end in '${SettingsFileExtension}'`);
        }

        // The collection id is the final dot-segment before the extension. Taking it from the end
        // keeps resource names containing dots from being misread as the collection id.
        const withoutExtension = fileName.slice(0, -SettingsFileExtension.length);
        const lastDot = withoutExtension.lastIndexOf('.');
        if (lastDot <= 0) {
            throw new Error(`Not a settings URI: '${fileName}' does not name a collection`);
        }

        return {
            accountId,
            portalHost,
            tenantId,
            armResourceId,
            collectionId: withoutExtension.slice(lastDot + 1),
        };
    },
} as const;
