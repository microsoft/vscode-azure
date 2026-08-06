/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Node, parseTree, printParseErrorCode } from 'jsonc-parser';
import type { IVsCode } from '../vscode/IVsCode';
import { type SettingsFormat, SettingsParseError } from './SettingsFormat';
import { type SettingsEntry, type SettingsMap, type SettingsSnapshot, UnreadableValue } from './SettingsModel';

/** Property name holding the value of a structured entry. */
const ValueProperty = 'value' as const;

/**
 * JSON-with-comments {@linkcode SettingsFormat}.
 *
 * Chosen over strict JSON so the document can carry a header explaining that saving writes to
 * Azure, which values cannot be read back, and that removing a key deletes the setting -- guidance
 * that has nowhere else to live in a plain editor. Comments are advisory only: they are stripped on
 * parse and regenerated on serialize, so user edits to the header are silently discarded rather
 * than persisted somewhere they could go stale.
 *
 * Unstructured collections serialize as `{ "KEY": "value" }`. Structured collections (those whose
 * entries carry {@linkcode SettingsEntry.metadata}) serialize as
 * `{ "KEY": { "value": "...", "type": "..." } }`, keeping the metadata visible and editable
 * alongside the value.
 */
export class JsoncSettingsFormat implements SettingsFormat {
    /** @inheritdoc */
    public readonly fileExtension = '.jsonc';

    public constructor(private readonly code: IVsCode) { }

    /** @inheritdoc */
    public serialize(snapshot: SettingsSnapshot): string {
        const body: Record<string, unknown> = {};

        for (const entry of snapshot.entries) {
            body[entry.key] = snapshot.structured
                ? { [ValueProperty]: entry.value, ...entry.metadata }
                : entry.value;
        }

        return `${this.buildHeader(snapshot)}\n${JSON.stringify(body, undefined, 4)}\n`;
    }

    /**
     * @inheritdoc
     * @throws {@linkcode SettingsParseError} on malformed JSON, a non-object root, duplicate keys,
     * or a value whose shape does not match the collection's `structured` flag.
     */
    public parse(text: string, snapshot: SettingsSnapshot): SettingsMap {
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

            entries.push(snapshot.structured
                ? this.readStructuredEntry(key, valueNode)
                : this.readScalarEntry(key, valueNode));
        }

        return entries;
    }

    private readScalarEntry(key: string, valueNode: Node): SettingsEntry {
        if (valueNode.type !== 'string') {
            throw new SettingsParseError(
                this.code.l10n.t('The value of \'{0}\' must be a quoted string. Numbers, booleans, and null are not valid setting values.', key),
                valueNode.offset,
                valueNode.length,
            );
        }

        return { key, value: String(valueNode.value) };
    }

    private readStructuredEntry(key: string, valueNode: Node): SettingsEntry {
        if (valueNode.type !== 'object') {
            throw new SettingsParseError(
                this.code.l10n.t('The value of \'{0}\' must be an object with a "{1}" property.', key, ValueProperty),
                valueNode.offset,
                valueNode.length,
            );
        }

        let value: string | undefined;
        const metadata: Record<string, string> = {};

        for (const property of valueNode.children ?? []) {
            const children = property.children ?? [];
            if (children.length < 2) {
                continue;
            }

            const [fieldNode, fieldValueNode] = children;
            const field = String(fieldNode.value);
            if (fieldValueNode.type !== 'string') {
                throw new SettingsParseError(
                    this.code.l10n.t('The "{0}" property of \'{1}\' must be a quoted string.', field, key),
                    fieldValueNode.offset,
                    fieldValueNode.length,
                );
            }

            if (field === ValueProperty) {
                value = String(fieldValueNode.value);
            } else {
                metadata[field] = String(fieldValueNode.value);
            }
        }

        if (value === undefined) {
            throw new SettingsParseError(
                this.code.l10n.t('\'{0}\' is missing its "{1}" property.', key, ValueProperty),
                valueNode.offset,
                valueNode.length,
            );
        }

        return { key, value, metadata };
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

        if (!snapshot.valuesReadable) {
            lines.push(this.code.l10n.t('Values shown as "{0}" cannot be read back. Leave them as-is to keep the current value.', UnreadableValue));
        }

        lines.push(this.code.l10n.t('This file lives only in the editor. Saving a copy to disk would store its values in plain text.'));

        return lines.map(line => `// ${line}`).join('\n');
    }
}
