/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import type { IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import type { SettingsNode } from '../tree/resources/settings/SettingsNode';

/** URI scheme under which settings documents are served. */
export const SettingsScheme = 'azure-settings';

/** Extension of a settings document. Selects the editor's `jsonc` language mode. */
const SettingsFileExtension = '.settings.jsonc';

const HexPattern = /^[0-9a-f]+$/i;

const PathSeparators = /[/\\]/g;

/**
 * Encodes and decodes the `azure-settings:` URIs that address settings documents.
 *
 * Shape:
 * ```
 * azure-settings:/<nodeKey>/<resourceName>.settings.jsonc
 * ```
 *
 * `<nodeKey>` is the hex-encoded {@linkcode AzureNodeId} of the **settings node** -- the tree's own
 * primary key. The document source therefore resolves a URI with an O(1) tree lookup, rather than
 * searching the tree by ARM id or rebuilding a resource out of the URI's parts. The trailing file
 * name exists only so the editor tab is readable and picks the `jsonc` language mode; nothing
 * parses meaning out of it.
 *
 * @remarks
 * The key is packed into the **path**, never the authority. VS Code lowercases a URI's authority
 * when round-tripping through `Uri.parse(uri.toString())` but preserves the path byte-for-byte, and
 * neither account ids nor ARM ids are safe to lowercase. Hex is used rather than base64url for the
 * same reason: it survives case normalization regardless.
 */
export const SettingsUri = {
    /** Build the document URI for a settings node. */
    from(code: IVsCode, node: SettingsNode): vscode.Uri {
        const nodeKey = Buffer.from(AzureNodeId.from(node).toString(), 'utf8').toString('hex');

        // A document name is a display string and may legitimately contain a path separator -- ARM
        // names a deployment slot 'site/slot' -- so flatten it to keep the file in one path segment.
        const fileName = `${node.documentName.replace(PathSeparators, '-')}${SettingsFileExtension}`;

        return code.Uri.from({ scheme: SettingsScheme, path: `/${nodeKey}/${fileName}` });
    },

    /**
     * Decode the tree node key a settings document URI addresses.
     *
     * @throws if the URI is not a well-formed settings document URI.
     */
    parseNodeKey(uri: vscode.Uri): string {
        if (uri.scheme !== SettingsScheme) {
            throw new Error(`Not a settings URI: expected scheme '${SettingsScheme}' but got '${uri.scheme}'`);
        }

        const segments = uri.path.split('/').filter(Boolean);
        if (segments.length !== 2) {
            throw new Error(`Not a settings URI: '${uri.path}' does not name a node key and a file`);
        }

        const [nodeKey, fileName] = segments;
        if (nodeKey.length % 2 !== 0 || !HexPattern.test(nodeKey)) {
            throw new Error('Not a settings URI: the node key segment must contain an even number of hexadecimal characters');
        }

        if (!fileName.endsWith(SettingsFileExtension)) {
            throw new Error(`Not a settings URI: '${fileName}' does not end in '${SettingsFileExtension}'`);
        }

        return Buffer.from(nodeKey, 'hex').toString('utf8');
    },
} as const;
