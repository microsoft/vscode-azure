/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { applyEdits, modify, parse as parseJsonc, type ParseError } from 'jsonc-parser';
import type { SettingsEntry, SettingsMap } from './SettingsModel';

/** Property under which the Functions host stores app settings in `local.settings.json`. */
const ValuesProperty = 'Values';

/**
 * Reads and writes a local settings file, hiding its on-disk shape behind {@linkcode SettingsMap}.
 *
 * Two conventions are supported:
 * - **`local.settings.json`** -- the Azure Functions host file, where settings live under a
 *   `Values` object alongside unrelated keys such as `IsEncrypted` and `ConnectionStrings`.
 * - **`.env`** -- plain `KEY=value` lines.
 *
 * Writes are **surgical**: for JSON, only the `Values` object is rewritten, so sibling properties,
 * comments, and formatting survive; for `.env`, comments and blank lines are preserved and only the
 * touched lines change. This matters because these files are checked into source control and a
 * settings sync must not reformat them.
 */
export class LocalSettingsFile {
    /**
     * @param fileName - Base name of the file, which selects the format. Anything that is not a
     * `.json`/`.jsonc` file is treated as `.env`.
     */
    public constructor(private readonly fileName: string) { }

    /** Whether this file uses the Functions host's JSON shape. */
    public get isJson(): boolean {
        return /\.jsonc?$/i.test(this.fileName);
    }

    /**
     * Parse file contents into settings.
     *
     * @throws if a JSON file cannot be parsed. A malformed local file must surface rather than be
     * silently treated as empty, which would look like "delete everything" in a diff.
     */
    public parse(contents: string): SettingsMap {
        return this.isJson ? this.parseJson(contents) : parseEnv(contents);
    }

    /**
     * Produce new file contents with {@linkcode entries} as the settings, preserving everything else
     * about the original.
     *
     * @param original - Existing contents, or `''` when the file does not exist yet.
     */
    public serialize(entries: SettingsMap, original: string): string {
        return this.isJson ? this.serializeJson(entries, original) : serializeEnv(entries, original);
    }

    private parseJson(contents: string): SettingsMap {
        return Object.entries(this.readJsonValues(contents))
            .filter((pair): pair is [string, string] => typeof pair[1] === 'string')
            .map(([key, value]) => ({ key, value }));
    }

    private serializeJson(entries: SettingsMap, original: string): string {
        const base = original.trim() ? original : `{\n    "IsEncrypted": false,\n    "${ValuesProperty}": {}\n}\n`;

        // Members that are not strings were never surfaced as settings (see `parseJson`), so they
        // are not the user's to have deleted by saving. Carry them through untouched rather than
        // letting a whole-node replacement drop them.
        const preserved = Object.fromEntries(
            Object.entries(this.readJsonValues(base)).filter(([, value]) => typeof value !== 'string'),
        );

        const values = { ...preserved, ...Object.fromEntries(entries.map(entry => [entry.key, entry.value])) };

        // `modify` rewrites only the targeted node, leaving sibling properties and formatting alone.
        const edits = modify(base, [ValuesProperty], values, {
            formattingOptions: { insertSpaces: true, tabSize: 4 },
        });

        return applyEdits(base, edits);
    }

    /**
     * The raw `Values` object, or `{}` when the file is empty or has no `Values`.
     *
     * @throws if the file is not parseable JSON.
     */
    private readJsonValues(contents: string): Record<string, unknown> {
        if (!contents.trim()) {
            return {};
        }

        const errors: ParseError[] = [];
        const parsed: unknown = parseJsonc(contents, errors, { allowTrailingComma: true });

        if (errors.length > 0) {
            throw new Error(`'${this.fileName}' is not valid JSON, so its settings cannot be read.`);
        }

        const values = (parsed as Record<string, unknown> | undefined)?.[ValuesProperty];
        return values && typeof values === 'object' ? values as Record<string, unknown> : {};
    }
}

/**
 * Parse `.env` contents.
 *
 * Blank lines and `#` comments are ignored. A value may be single- or double-quoted, which is how a
 * value containing spaces or a `#` is expressed; quotes are stripped.
 */
function parseEnv(contents: string): SettingsMap {
    const entries: SettingsEntry[] = [];

    for (const line of contents.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const separator = trimmed.indexOf('=');
        if (separator <= 0) {
            continue;
        }

        const key = trimmed.slice(0, separator).trim();
        entries.push({ key, value: unquote(trimmed.slice(separator + 1).trim()) });
    }

    return entries;
}

/**
 * Rewrite `.env` contents.
 *
 * Existing lines are updated in place so comments, ordering, and spacing survive; removed settings
 * drop their lines, and new settings are appended.
 */
function serializeEnv(entries: SettingsMap, original: string): string {
    const remaining = new Map(entries.map(entry => [entry.key, entry.value]));
    const lines = original ? original.split(/\r?\n/) : [];
    const output: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        const separator = trimmed.indexOf('=');

        if (!trimmed || trimmed.startsWith('#') || separator <= 0) {
            output.push(line);
            continue;
        }

        const key = trimmed.slice(0, separator).trim();
        if (!remaining.has(key)) {
            // Dropped from the settings, so drop its line.
            continue;
        }

        output.push(`${key}=${quoteIfNeeded(remaining.get(key) ?? '')}`);
        remaining.delete(key);
    }

    while (output.length > 0 && !output[output.length - 1].trim()) {
        output.pop();
    }

    for (const [key, value] of remaining) {
        output.push(`${key}=${quoteIfNeeded(value)}`);
    }

    return `${output.join('\n')}\n`;
}

function unquote(value: string): string {
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        // Double-quoted values are written with JSON escaping, so they must be unescaped the same
        // way. Stripping only the outer quotes would turn `"say \"hi\""` into `say \"hi\"`, and each
        // download/upload cycle would add another layer of backslashes.
        try {
            return JSON.parse(value) as string;
        } catch {
            // Not valid JSON (e.g. hand-written `"C:\path"`); fall back to stripping the quotes,
            // which is what a user writing that by hand would expect.
            return value.slice(1, -1);
        }
    }

    // Single-quoted values are literal: no escape sequences are recognized inside them, matching
    // POSIX shell semantics, which is why `quoteIfNeeded` never emits them for values containing a
    // single quote.
    if (value.length >= 2 && value.startsWith('\'') && value.endsWith('\'')) {
        return value.slice(1, -1);
    }

    return value;
}

/**
 * Quote a value if writing it bare would not round-trip.
 *
 * Uses JSON quoting, which escapes embedded quotes, backslashes, and newlines, so
 * {@linkcode unquote} can recover the exact original. A value containing a newline is therefore
 * written on one physical line rather than corrupting the file's line structure.
 */
function quoteIfNeeded(value: string): string {
    return /[\s#'"\\]/.test(value) ? JSON.stringify(value) : value;
}
