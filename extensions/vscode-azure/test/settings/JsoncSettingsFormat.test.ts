/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { JsoncSettingsFormat, SettingsParseError } from '../../src/settings/JsoncSettingsFormat';
import type { SettingsMap, SettingsSnapshot } from '../../src/settings/SettingsModel';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';

function createSnapshot(overrides?: Partial<SettingsSnapshot>): SettingsSnapshot {
    return {
        entries: [],
        resourceName: 'myFunctionApp',
        label: 'Application settings',
        writable: true,
        ...overrides,
    };
}

function createFormat(): JsoncSettingsFormat {
    return new JsoncSettingsFormat(createMockVsCode().vscode);
}

describe('JsoncSettingsFormat (unit)', () => {
    describe('serialize', () => {
        it('renders entries as a JSON object', () => {
            const format = createFormat();
            const text = format.serialize(createSnapshot({
                entries: [{ key: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }],
            }));

            expect(text).to.contain('"FUNCTIONS_WORKER_RUNTIME": "node"');
        });

        it('names the resource and collection in the header', () => {
            const format = createFormat();
            const text = format.serialize(createSnapshot());

            expect(text).to.contain('// Application settings for \'myFunctionApp\'.');
        });

        it('explains last-writer-wins save semantics when writable', () => {
            const format = createFormat();
            const text = format.serialize(createSnapshot());

            expect(text).to.contain('overwrites any changes made elsewhere');
        });

        it('warns that deployments may overwrite live edits', () => {
            const format = createFormat();
            const text = format.serialize(createSnapshot());

            expect(text).to.contain('Deployments and infrastructure-as-code tools may overwrite edits made here.');
        });

        it('says the document is read-only instead when it is not writable', () => {
            const format = createFormat();
            const text = format.serialize(createSnapshot({ writable: false }));

            expect(text).to.contain('read-only');
            expect(text).to.not.contain('Removing a setting deletes it.');
        });
    });

    describe('parse', () => {
        it('reads a plain object of settings', () => {
            const format = createFormat();
            const parsed = format.parse('{ "A": "1", "B": "2" }');

            expect(parsed).to.deep.equal([{ key: 'A', value: '1' }, { key: 'B', value: '2' }]);
        });

        it('ignores comments, including the generated header', () => {
            const format = createFormat();
            const parsed = format.parse('// a header\n// another line\n{ "A": "1" }');

            expect(parsed).to.deep.equal([{ key: 'A', value: '1' }]);
        });

        it('preserves document order', () => {
            const format = createFormat();
            const parsed = format.parse('{ "Z": "1", "A": "2" }');

            expect(parsed.map(e => e.key)).to.deep.equal(['Z', 'A']);
        });

        it('accepts an empty object', () => {
            const format = createFormat();
            expect(format.parse('{}')).to.be.empty;
        });

        it('tolerates a trailing comma', () => {
            const format = createFormat();
            expect(format.parse('{ "A": "1", }')).to.deep.equal([{ key: 'A', value: '1' }]);
        });

        it('throws with a position for malformed JSON', () => {
            const format = createFormat();
            expect(() => format.parse('{ "A": '))
                .to.throw(SettingsParseError, /not valid JSON/);
        });

        it('throws when the root is not an object', () => {
            const format = createFormat();
            expect(() => format.parse('["A"]'))
                .to.throw(SettingsParseError, /single JSON object/);
        });

        it('rejects duplicate keys, pointing at the second one', () => {
            const format = createFormat();
            const text = '{ "A": "1", "A": "2" }';

            try {
                format.parse(text);
                expect.fail('expected a SettingsParseError');
            } catch (error) {
                expect(error).to.be.instanceOf(SettingsParseError);
                const parseError = error as SettingsParseError;
                expect(parseError.message).to.contain('listed more than once');
                expect(text.slice(parseError.offset, parseError.offset + parseError.length)).to.equal('"A"');
                expect(parseError.offset).to.be.greaterThan(text.indexOf('"A"'));
            }
        });

        it('rejects two names differing only by capitalization, naming both spellings', () => {
            const format = createFormat();
            const text = '{ "MySetting": "1", "MYSETTING": "2" }';

            try {
                format.parse(text);
                expect.fail('expected a SettingsParseError');
            } catch (error) {
                expect(error).to.be.instanceOf(SettingsParseError);
                const parseError = error as SettingsParseError;
                expect(parseError.message).to.contain('differ only by capitalization');
                // Both spellings, so the user can tell which two names collided.
                expect(parseError.message).to.contain('MySetting');
                expect(parseError.message).to.contain('MYSETTING');
                // Points at the second spelling, as the plain duplicate case does.
                expect(text.slice(parseError.offset, parseError.offset + parseError.length)).to.equal('"MYSETTING"');
            }
        });

        it('still accepts names that differ by more than capitalization', () => {
            const format = createFormat();

            expect(format.parse('{ "A_ONE": "1", "A_TWO": "2" }')).to.deep.equal([
                { key: 'A_ONE', value: '1' },
                { key: 'A_TWO', value: '2' },
            ]);
        });

        it('rejects a non-string value', () => {
            const format = createFormat();
            expect(() => format.parse('{ "PORT": 8080 }'))
                .to.throw(SettingsParseError, /must be a quoted string/);
        });

        it('rejects null and boolean values', () => {
            const format = createFormat();
            expect(() => format.parse('{ "A": null }')).to.throw(SettingsParseError);
            expect(() => format.parse('{ "A": true }')).to.throw(SettingsParseError);
        });

        it('reports the offending span for a non-string value', () => {
            const format = createFormat();
            const text = '{ "PORT": 8080 }';

            try {
                format.parse(text);
                expect.fail('expected a SettingsParseError');
            } catch (error) {
                const parseError = error as SettingsParseError;
                expect(text.slice(parseError.offset, parseError.offset + parseError.length)).to.equal('8080');
            }
        });
    });

    describe('round-trip', () => {
        it('preserves entries exactly', () => {
            const format = createFormat();
            const entries: SettingsMap = [
                { key: 'A', value: '1' },
                { key: 'WITH SPACES', value: 'has "quotes" and \\ backslash' },
                { key: 'EMPTY', value: '' },
                { key: 'MULTILINE', value: 'line1\nline2' },
                { key: 'UNICODE', value: 'caf\u00e9' },
            ];
            const snapshot = createSnapshot({ entries });

            expect(format.parse(format.serialize(snapshot))).to.deep.equal(entries);
        });
    });
});
