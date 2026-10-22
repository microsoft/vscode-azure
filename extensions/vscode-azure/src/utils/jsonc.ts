/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExternalError, type IVsCode } from '@microsoft/vscode-azure-utils';
import { applyEdits, modify, parseTree, type JSONPath, type Node, type ParseError } from 'jsonc-parser';

/** Parses a JSONC object and rejects duplicate root properties; nested value validation belongs to the caller. */
export function parseJsoncObject(code: IVsCode, text: string, label: string): Node {
    const errors: ParseError[] = [];
    const root = parseTree(text, errors, { allowTrailingComma: true });
    if (errors.length || root?.type !== 'object') {
        throw new ExternalError(code.l10n.t('{0} must contain a valid JSON object.', label));
    }
    const names = new Set<string>();
    for (const property of root.children ?? []) {
        const name: unknown = property.children?.[0].value;
        if (typeof name === 'string') {
            if (names.has(name)) {
                throw new ExternalError(code.l10n.t('{0} must not contain duplicate properties.', label));
            }
            names.add(name);
        }
    }
    return root;
}

/** Edits one JSONC path, preserving comments, unrelated properties, and the document's LF or CRLF line endings. */
export function editJsonc(text: string, path: JSONPath, value: unknown): string {
    return applyEdits(text, modify(text, path, value, {
        formattingOptions: { insertSpaces: true, tabSize: 4, eol: text.includes('\r\n') ? '\r\n' : '\n' },
    }));
}
