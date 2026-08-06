/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SettingsMap, SettingsSnapshot } from './SettingsModel';

/**
 * Serializes a {@linkcode SettingsSnapshot} to editable document text and parses it back.
 *
 * Implementations must round-trip: `parse(serialize(snapshot)).entries` must equal
 * `snapshot.entries`. Anything a format cannot represent losslessly (comments, key ordering,
 * formatting) is the format's own business and must not leak into {@linkcode SettingsMap}.
 *
 * The interface exists so a `.env` or YAML format can be added without touching the file system
 * provider, which is format-agnostic.
 */
export interface SettingsFormat {
    /** File extension including the leading dot, e.g. `.jsonc`. Determines the editor language. */
    readonly fileExtension: string;

    /** Render a snapshot as document text, including any explanatory header. */
    serialize(snapshot: SettingsSnapshot): string;

    /**
     * Parse document text back into settings.
     *
     * @throws {@linkcode SettingsParseError} for any content the user must fix before saving.
     */
    parse(text: string, snapshot: SettingsSnapshot): SettingsMap;
}

/**
 * A user-fixable problem in the settings document, carrying a 0-based offset and length so callers
 * can surface it against the editor's text.
 *
 * Thrown rather than collected because a settings document that does not parse cannot be partially
 * saved -- the first problem is the one the user needs to fix.
 */
export class SettingsParseError extends Error {
    public constructor(
        message: string,
        /** 0-based character offset into the document text. */
        public readonly offset: number,
        /** Length of the offending span, in characters. May be 0 for a point error. */
        public readonly length: number = 0,
    ) {
        super(message);
        this.name = 'SettingsParseError';
    }
}
