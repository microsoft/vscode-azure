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

const HexPattern = /^[0-9a-f]+$/i;

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
    readonly subscriptionDisplayName: string;
    /** ARM id of the resource that owns the settings. */
    readonly armResourceId: string;
    readonly resourceName: string;
    readonly resourceType: string;
    readonly logicalType: string;
    readonly location: string;
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
 * `<identity>` is a hex-encoded JSON payload containing the account identity and the minimal resource
 * context needed to recreate a {@linkcode import('@microsoft/vscode-azure-azutils').GenericResource}
 * after a window reload.
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
            subscriptionDisplayName: resource.subscription.displayName,
            armResourceId: resource.id,
            resourceName: resource.name,
            resourceType: resource.type,
            logicalType: resource.logicalType,
            location: resource.location,
            collectionId: node.virtualPath,
        });
    },

    /** Build the document URI from raw parts. */
    fromParts(code: IVsCode, parts: SettingsUriParts): vscode.Uri {
        const identity = Buffer
            .from(JSON.stringify({
                accountId: parts.accountId,
                portalHost: parts.portalHost,
                tenantId: parts.tenantId,
                subscriptionDisplayName: parts.subscriptionDisplayName,
                resourceName: parts.resourceName,
                resourceType: parts.resourceType,
                logicalType: parts.logicalType,
                location: parts.location,
            } satisfies IdentityPayload), 'utf8')
            .toString('hex');

        // `armResourceId` already starts with '/', so it splices in directly.
        const fileName = `${parts.resourceName}.${parts.collectionId}${SettingsFileExtension}`;
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

        if (identity.length % 2 !== 0 || !HexPattern.test(identity)) {
            throw new Error('Not a settings URI: the identity segment must contain an even number of hexadecimal characters');
        }

        let payload: unknown;
        try {
            payload = JSON.parse(Buffer.from(identity, 'hex').toString('utf8'));
        } catch {
            throw new Error('Not a settings URI: the identity segment is malformed');
        }
        if (!isIdentityPayload(payload)) {
            throw new Error('Not a settings URI: the identity segment is missing required resource context');
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
            ...payload,
            armResourceId,
            collectionId: withoutExtension.slice(lastDot + 1),
        };
    },
} as const;

type IdentityPayload = Omit<SettingsUriParts, 'armResourceId' | 'collectionId'>;

function isIdentityPayload(value: unknown): value is IdentityPayload {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const payload = value as Record<keyof IdentityPayload, unknown>;
    return typeof payload.accountId === 'string' && payload.accountId.length > 0
        && typeof payload.portalHost === 'string' && payload.portalHost.length > 0
        && typeof payload.tenantId === 'string' && payload.tenantId.length > 0
        && typeof payload.subscriptionDisplayName === 'string' && payload.subscriptionDisplayName.length > 0
        && typeof payload.resourceName === 'string' && payload.resourceName.length > 0
        && typeof payload.resourceType === 'string' && payload.resourceType.length > 0
        && typeof payload.logicalType === 'string' && payload.logicalType.length > 0
        && typeof payload.location === 'string';
}
