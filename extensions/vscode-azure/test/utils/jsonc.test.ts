/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExternalError } from '@microsoft/vscode-azure-utils';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { getNodeValue } from 'jsonc-parser';
import { editJsonc, parseJsoncObject } from '../../src/utils/jsonc';

describe('JSONC object editing (unit)', () => {
    const { vscode: code } = createMockVsCode();

    for (const eol of ['\n', '\r\n']) {
        it(`appends array entries while preserving comments and ${eol.length === 1 ? 'LF' : 'CRLF'} line endings`, () => {
            const text = [
                '{',
                '    // retain this comment',
                '    "items": [/* existing item */ "existing",],',
                '    "unrelated": true,',
                '}',
            ].join(eol);
            const edited = editJsonc(text, ['items', -1], 'added');
            const value: unknown = getNodeValue(parseJsoncObject(code, edited, 'document.json'));
            expect(value).to.deep.equal({ items: ['existing', 'added'], unrelated: true });
            expect(edited).to.include('// retain this comment').and.include('/* existing item */');
            expect(edited).to.include(eol);
            if (eol === '\r\n') {
                expect(edited.replaceAll('\r\n', '')).not.to.include('\n');
            } else {
                expect(edited).not.to.include('\r');
            }
        });
    }

    it('creates a missing nested property without replacing unrelated values', () => {
        const edited = editJsonc('{ "Host": { "LocalHttpPort": 8090 } }', ['Values', 'FUNCTIONS_WORKER_RUNTIME'], 'node');
        const value: unknown = getNodeValue(parseJsoncObject(code, edited, 'local.settings.json'));
        expect(value).to.deep.equal({ Host: { LocalHttpPort: 8090 }, Values: { ['FUNCTIONS_WORKER_RUNTIME']: 'node' } });
    });

    it('rejects malformed documents and non-object roots with the caller document label', () => {
        for (const text of ['{ invalid', '[]', 'null', 'false', '"text"']) {
            expect(() => parseJsoncObject(code, text, 'document.json'))
                .to.throw(ExternalError, 'document.json must contain a valid JSON object.');
        }
    });

    it('rejects duplicate root properties and leaves nested validation to the caller', () => {
        expect(() => parseJsoncObject(code, '{ "Values": {}, "Values": {} }', 'local.settings.json'))
            .to.throw(ExternalError, 'local.settings.json must not contain duplicate properties.');
        const root = parseJsoncObject(code, '{ "Values": { "Key": 1, "key": 2 } }', 'local.settings.json');
        const value: unknown = getNodeValue(root);
        expect(value).to.deep.equal({ Values: { Key: 1, key: 2 } });
    });
});
