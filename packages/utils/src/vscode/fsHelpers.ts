/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { Utils } from 'vscode-uri';
import { ExternalError } from '../base/ExternalError';
import type { IVsCode } from './IVsCode';

/**
 * Returns `true` when {@linkcode uri} exists on disk (as a file or directory).
 * Swallows the FS error so callers can treat the result as a boolean.
 */
export async function fileExists(code: IVsCode, uri: vscode.Uri): Promise<boolean> {
    try {
        await code.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

/**
 * Returns `true` when `error` is the filesystem error raised for a missing
 * file or directory.
 *
 * Useful for telling an expected race (something deleted while it was being
 * enumerated) apart from a real failure such as a permissions error, which
 * should not be swallowed.
 */
export function isFileNotFoundError(error: unknown): boolean {
    return error !== null
        && typeof error === 'object'
        && 'code' in error
        && error.code === 'FileNotFound';
}

/**
 * Returns the POSIX-style path of {@linkcode uri} relative to
 * {@linkcode base}, or `undefined` when `uri` is not inside `base`.
 *
 * Returns an empty string when the two refer to the same location. Compares
 * paths only, so both should share a scheme and authority.
 *
 * Hand-written because `vscode-uri`'s `Utils` only offers the joining
 * direction (`joinPath`, `resolvePath`, `dirname`, `basename`, `extname`) and
 * has no relative-path counterpart.
 */
export function relativePath(base: vscode.Uri, uri: vscode.Uri): string | undefined {
    const basePath = base.path.replace(/\/+$/, '');
    if (uri.path === basePath) {
        return '';
    }
    return uri.path.startsWith(`${basePath}/`)
        ? uri.path.slice(basePath.length + 1)
        : undefined;
}

/**
 * Reads {@linkcode uri} as UTF-8 text, or returns `undefined` when it does not
 * exist.
 *
 * Only the missing-file case is swallowed; other failures (permissions, a
 * failing filesystem provider) propagate so they are not mistaken for an empty
 * file.
 */
export async function readText(code: IVsCode, uri: vscode.Uri): Promise<string | undefined> {
    try {
        return new TextDecoder().decode(await code.workspace.fs.readFile(uri));
    } catch (error) {
        if (isFileNotFoundError(error)) {
            return undefined;
        }
        throw error;
    }
}

/**
 * Reads {@linkcode uri} as JSON, or returns `undefined` when it does not exist
 * or is malformed.
 *
 * Malformed JSON reads as absent because these files are usually
 * work-in-progress edits, and a half-typed manifest should not fail the caller.
 *
 * @typeParam T - Shape the caller expects. This is an **unvalidated assertion**
 *   over whatever the file contained, exactly like `JSON.parse(...) as T`;
 *   supply it only when the caller is prepared for the file to disagree.
 *   Defaults to `unknown`, which forces the caller to narrow.
 */
export async function readJson<T = unknown>(code: IVsCode, uri: vscode.Uri): Promise<T | undefined> {
    const contents = await readText(code, uri);
    if (contents === undefined) {
        return undefined;
    }
    try {
        return JSON.parse(contents) as T;
    } catch (error) {
        if (error instanceof SyntaxError) {
            return undefined;
        }
        throw error;
    }
}

/**
 * Reads a required JSON file; callers must validate the parsed value.
 *
 * @typeParam T - Shape the caller expects. This is an unvalidated assertion,
 *   not runtime validation. Defaults to `unknown`, which forces the caller to narrow.
 *
 * @throws {@linkcode ExternalError} when the file is missing or malformed, with
 * only its basename in the message. Other filesystem failures propagate unchanged.
 */
export async function readRequiredJson<T = unknown>(code: IVsCode, uri: vscode.Uri): Promise<T> {
    const text = await readText(code, uri);
    if (text === undefined) {
        throw new ExternalError(code.l10n.t('The file \'{0}\' is missing.', basename(uri)));
    }
    try {
        return JSON.parse(text) as T;
    } catch (error: unknown) {
        if (!(error instanceof SyntaxError)) {
            throw error;
        }
        throw new ExternalError(code.l10n.t('The file \'{0}\' is not valid JSON.', basename(uri)));
    }
}

/**
 * Returns the last path segment of {@linkcode uri}, used as a compact
 * display label (typically the folder name) in tree items.
 */
export function basename(uri: vscode.Uri): string {
    const segments = uri.path.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? uri.path;
}

/**
 * Returns the parent directory of {@linkcode uri}.
 *
 * At the root, the result equals the input -- walk upwards by comparing
 * {@linkcode vscode.Uri.path path} against the previous value to know when to
 * stop, rather than looping unconditionally.
 */
export function dirname(uri: vscode.Uri): vscode.Uri {
    return Utils.dirname(uri);
}
