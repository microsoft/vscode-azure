/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { JsoncSettingsFormat } from '../../src/settings/JsoncSettingsFormat';
import { SettingsParseError } from '../../src/settings/SettingsFormat';
import { type SettingsMap, type SettingsSnapshot, UnreadableValue } from '../../src/settings/SettingsModel';
import { createMockVsCode } from '../vscode/MockVsCode';

function createSnapshot(overrides?: Partial<SettingsSnapshot>): SettingsSnapshot {
    return {
        entries: [],
        resourceName: 'myFunctionApp',
        collectionLabel: 'Application settings',
        valuesReadable: true,
        writable: true,
        structured: false,
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

        it('warns that saving a copy to disk stores plaintext values', () => {
            const format = createFormat();
            const text = format.serialize(createSnapshot());

            expect(text).to.contain('plain text');
        });

        it('explains the sentinel only when values are unreadable', () => {
            const format = createFormat();

            expect(format.serialize(createSnapshot({ valuesReadable: false }))).to.contain('cannot be read back');
            expect(format.serialize(createSnapshot({ valuesReadable: true }))).to.not.contain('cannot be read back');
        });

        it('describes unreadable collections as read-only', () => {
            const text = createFormat().serialize(createSnapshot({ valuesReadable: false }));

            expect(text).to.contain('read-only');
            expect(text).to.contain('cannot be edited safely');
            expect(text).to.not.contain('Saving this file writes');
        });

        it('nests value and metadata for structured collections', () => {
            const format = createFormat();
            const text = format.serialize(createSnapshot({
                structured: true,
                entries: [{ key: 'DB', value: 'conn-string', metadata: { type: 'SQLAzure' } }],
            }));

            expect(text).to.contain('"value": "conn-string"');
            expect(text).to.contain('"type": "SQLAzure"');
        });
    });

    describe('parse', () => {
        it('reads a plain object of settings', () => {
            const format = createFormat();
            const parsed = format.parse('{ "A": "1", "B": "2" }', createSnapshot());

            expect(parsed).to.deep.equal([{ key: 'A', value: '1' }, { key: 'B', value: '2' }]);
        });

        it('ignores comments, including the generated header', () => {
            const format = createFormat();
            const parsed = format.parse('// a header\n// another line\n{ "A": "1" }', createSnapshot());

            expect(parsed).to.deep.equal([{ key: 'A', value: '1' }]);
        });

        it('preserves document order', () => {
            const format = createFormat();
            const parsed = format.parse('{ "Z": "1", "A": "2" }', createSnapshot());

            expect(parsed.map(e => e.key)).to.deep.equal(['Z', 'A']);
        });

        it('accepts an empty object', () => {
            const format = createFormat();
            expect(format.parse('{}', createSnapshot())).to.be.empty;
        });

        it('tolerates a trailing comma', () => {
            const format = createFormat();
            expect(format.parse('{ "A": "1", }', createSnapshot())).to.deep.equal([{ key: 'A', value: '1' }]);
        });

        it('throws with a position for malformed JSON', () => {
            const format = createFormat();
            expect(() => format.parse('{ "A": ', createSnapshot()))
                .to.throw(SettingsParseError, /not valid JSON/);
        });

        it('throws when the root is not an object', () => {
            const format = createFormat();
            expect(() => format.parse('["A"]', createSnapshot()))
                .to.throw(SettingsParseError, /single JSON object/);
        });

        it('rejects duplicate keys, pointing at the second one', () => {
            const format = createFormat();
            const text = '{ "A": "1", "A": "2" }';

            try {
                format.parse(text, createSnapshot());
                expect.fail('expected a SettingsParseError');
            } catch (error) {
                expect(error).to.be.instanceOf(SettingsParseError);
                const parseError = error as SettingsParseError;
                expect(parseError.message).to.contain('A');
                expect(text.slice(parseError.offset, parseError.offset + parseError.length)).to.equal('"A"');
                expect(parseError.offset).to.be.greaterThan(text.indexOf('"A"'));
            }
        });

        it('rejects a non-string value', () => {
            const format = createFormat();
            expect(() => format.parse('{ "PORT": 8080 }', createSnapshot()))
                .to.throw(SettingsParseError, /must be a quoted string/);
        });

        it('rejects null and boolean values', () => {
            const format = createFormat();
            expect(() => format.parse('{ "A": null }', createSnapshot())).to.throw(SettingsParseError);
            expect(() => format.parse('{ "A": true }', createSnapshot())).to.throw(SettingsParseError);
        });

        it('reports the offending span for a non-string value', () => {
            const format = createFormat();
            const text = '{ "PORT": 8080 }';

            try {
                format.parse(text, createSnapshot());
                expect.fail('expected a SettingsParseError');
            } catch (error) {
                const parseError = error as SettingsParseError;
                expect(text.slice(parseError.offset, parseError.offset + parseError.length)).to.equal('8080');
            }
        });

        describe('structured collections', () => {
            const structured = createSnapshot({ structured: true });

            it('splits value from metadata', () => {
                const format = createFormat();
                const parsed = format.parse('{ "DB": { "value": "conn", "type": "SQLAzure" } }', structured);

                expect(parsed).to.deep.equal([{ key: 'DB', value: 'conn', metadata: { type: 'SQLAzure' } }]);
            });

            it('rejects a scalar value', () => {
                const format = createFormat();
                expect(() => format.parse('{ "DB": "conn" }', structured))
                    .to.throw(SettingsParseError, /must be an object/);
            });

            it('rejects an object with no value property', () => {
                const format = createFormat();
                expect(() => format.parse('{ "DB": { "type": "SQLAzure" } }', structured))
                    .to.throw(SettingsParseError, /missing its "value" property/);
            });

            it('rejects a non-string metadata field', () => {
                const format = createFormat();
                expect(() => format.parse('{ "DB": { "value": "conn", "type": 3 } }', structured))
                    .to.throw(SettingsParseError, /must be a quoted string/);
            });
        });
    });

    describe('round-trip', () => {
        it('preserves unstructured entries exactly', () => {
            const format = createFormat();
            const entries: SettingsMap = [
                { key: 'A', value: '1' },
                { key: 'WITH SPACES', value: 'has "quotes" and \\ backslash' },
                { key: 'EMPTY', value: '' },
                { key: 'MULTILINE', value: 'line1\nline2' },
                { key: 'UNICODE', value: 'caf\u00e9' },
            ];
            const snapshot = createSnapshot({ entries });

            expect(format.parse(format.serialize(snapshot), snapshot)).to.deep.equal(entries);
        });

        it('preserves structured entries exactly', () => {
            const format = createFormat();
            const entries: SettingsMap = [{ key: 'DB', value: 'conn', metadata: { type: 'SQLAzure' } }];
            const snapshot = createSnapshot({ structured: true, entries });

            expect(format.parse(format.serialize(snapshot), snapshot)).to.deep.equal(entries);
        });

        it('round-trips the sentinel in the serialized read-only representation', () => {
            const format = createFormat();
            const entries: SettingsMap = [{ key: 'SECRET', value: UnreadableValue }];
            const snapshot = createSnapshot({ valuesReadable: false, entries });

            expect(format.parse(format.serialize(snapshot), snapshot)).to.deep.equal(entries);
        });
    });
});
