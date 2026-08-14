/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseTree, printParseErrorCode } from 'jsonc-parser';
import type { IVsCode } from '@microsoft/vscode-azure-utils';
import type { SettingsEntry, SettingsMap, SettingsSnapshot } from './SettingsModel';

/** File extension of a settings document. Selects the editor's `jsonc` language mode. */
export const SettingsFileExtension = '.jsonc';

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

/**
 * Renders a {@linkcode SettingsSnapshot} as JSON-with-comments and parses it back.
 *
 * JSONC rather than strict JSON so the document can carry a header explaining that saving writes to
 * Azure and that removing a key deletes the setting -- guidance that has nowhere else to live in a
 * plain editor. Comments are advisory only: they are stripped on parse and regenerated on serialize,
 * so edits to the header are discarded rather than persisted somewhere they could go stale.
 */
export class JsoncSettingsFormat {
    public constructor(private readonly code: IVsCode) { }

    /** Render a snapshot as document text, including the explanatory header. */
    public serialize(snapshot: SettingsSnapshot): string {
        const body: Record<string, string> = {};
        for (const entry of snapshot.entries) {
            body[entry.key] = entry.value;
        }

        return `${this.buildHeader(snapshot)}\n${JSON.stringify(body, undefined, 4)}\n`;
    }

    /**
     * Parse document text back into settings.
     *
     * @throws {@linkcode SettingsParseError} on malformed JSON, a non-object root, duplicate keys,
     * or a non-string value.
     */
    public parse(text: string): SettingsMap {
        const errors: { error: number; offset: number; length: number }[] = [];
        const root = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });

        if (errors.length > 0) {
            const [first] = errors;
            throw new SettingsParseError(
                this.code.l10n.t('The settings file is not valid JSON: {0}.', printParseErrorCode(first.error)),
                first.offset,
                first.length,
            );
        }

        if (root?.type !== 'object') {
            throw new SettingsParseError(
                this.code.l10n.t('The settings file must contain a single JSON object of setting names and values.'),
                root?.offset ?? 0,
                root?.length ?? text.length,
            );
        }

        const entries: SettingsEntry[] = [];
        const seen = new Set<string>();

        for (const property of root.children ?? []) {
            const children = property.children ?? [];
            if (children.length < 2) {
                // A property still being typed (`"KEY":` with no value yet). `parseTree` reports
                // this through `errors`, so reaching here means the document is well-formed but
                // shaped unexpectedly; skip rather than crash.
                continue;
            }

            const [keyNode, valueNode] = children;
            const key = String(keyNode.value);
            if (seen.has(key)) {
                throw new SettingsParseError(
                    this.code.l10n.t('The setting \'{0}\' is listed more than once. Setting names must be unique.', key),
                    keyNode.offset,
                    keyNode.length,
                );
            }
            seen.add(key);

            if (valueNode.type !== 'string') {
                throw new SettingsParseError(
                    this.code.l10n.t('The value of \'{0}\' must be a quoted string. Numbers, booleans, and null are not valid setting values.', key),
                    valueNode.offset,
                    valueNode.length,
                );
            }

            entries.push({ key, value: String(valueNode.value) });
        }

        return entries;
    }

    private buildHeader(snapshot: SettingsSnapshot): string {
        const lines = [
            this.code.l10n.t('{0} for \'{1}\'.', snapshot.collectionLabel, snapshot.resourceName),
        ];

        if (snapshot.writable) {
            lines.push(this.code.l10n.t('Saving this file writes these settings to Azure. Removing a setting deletes it.'));
            lines.push(this.code.l10n.t('The file is saved to Azure as-is: it overwrites any changes made elsewhere since it was opened.'));
            lines.push(this.code.l10n.t('Deployments and infrastructure-as-code tools may overwrite edits made here.'));
        } else {
            lines.push(this.code.l10n.t('These settings are read-only and cannot be edited here.'));
        }

        return lines.map(line => `// ${line}`).join('\n');
    }
}
