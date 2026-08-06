/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { LocalSettingsFile } from '../../src/settings/LocalSettingsFile';

describe('LocalSettingsFile (unit)', () => {
    describe('local.settings.json', () => {
        const file = new LocalSettingsFile('local.settings.json');

        it('reads settings from the Values object', () => {
            const contents = JSON.stringify({ IsEncrypted: false, Values: { A: '1', B: '2' } });

            expect(file.parse(contents)).to.deep.equal([{ key: 'A', value: '1' }, { key: 'B', value: '2' }]);
        });

        it('ignores non-string values, which are not app settings', () => {
            const contents = JSON.stringify({ Values: { A: '1', Nope: 3, AlsoNope: null } });

            expect(file.parse(contents)).to.deep.equal([{ key: 'A', value: '1' }]);
        });

        it('treats a file with no Values object as empty', () => {
            expect(file.parse(JSON.stringify({ IsEncrypted: false }))).to.be.empty;
        });

        it('treats an empty file as empty', () => {
            expect(file.parse('')).to.be.empty;
            expect(file.parse('   \n ')).to.be.empty;
        });

        it('tolerates comments, as the Functions host does', () => {
            const contents = '{\n  // a comment\n  "Values": { "A": "1" }\n}';

            expect(file.parse(contents)).to.deep.equal([{ key: 'A', value: '1' }]);
        });

        it('refuses to silently treat malformed JSON as empty', () => {
            expect(() => file.parse('{ "Values": ')).to.throw(/local.settings.json/);
        });

        it('preserves sibling properties when writing', () => {
            const original = JSON.stringify({ IsEncrypted: false, ConnectionStrings: { X: 'y' }, Values: { OLD: '1' } }, undefined, 4);

            const result = JSON.parse(file.serialize([{ key: 'NEW', value: '2' }], original)) as Record<string, unknown>;

            expect(result.IsEncrypted).to.be.false;
            expect(result.ConnectionStrings).to.deep.equal({ X: 'y' });
            expect(result.Values).to.deep.equal({ NEW: '2' });
        });

        it('replaces the Values object wholesale, so omitted keys are deleted', () => {
            const original = JSON.stringify({ Values: { KEEP: '1', DROP: '2' } }, undefined, 4);

            const result = JSON.parse(file.serialize([{ key: 'KEEP', value: '1' }], original)) as { Values: unknown };

            expect(result.Values).to.deep.equal({ KEEP: '1' });
        });

        it('preserves non-string members of Values, which were never surfaced as settings', () => {
            // Deleting these on save would destroy data the user never saw in the editor.
            const original = JSON.stringify({ Values: { A: '1', Nested: { x: 1 }, Count: 5 } }, undefined, 4);

            const result = JSON.parse(file.serialize([{ key: 'A', value: 'updated' }], original)) as { Values: Record<string, unknown> };

            expect(result.Values.Nested).to.deep.equal({ x: 1 });
            expect(result.Values.Count).to.equal(5);
            expect(result.Values.A).to.equal('updated');
        });

        it('creates a well-formed file from nothing', () => {
            const result = JSON.parse(file.serialize([{ key: 'A', value: '1' }], '')) as Record<string, unknown>;

            expect(result.IsEncrypted).to.be.false;
            expect(result.Values).to.deep.equal({ A: '1' });
        });

        it('round-trips', () => {
            const entries = [{ key: 'A', value: '1' }, { key: 'B', value: 'has spaces' }];

            expect(file.parse(file.serialize(entries, ''))).to.deep.equal(entries);
        });
    });

    describe('.env', () => {
        const file = new LocalSettingsFile('.env');

        it('reads KEY=value lines', () => {
            expect(file.parse('A=1\nB=2\n')).to.deep.equal([{ key: 'A', value: '1' }, { key: 'B', value: '2' }]);
        });

        it('ignores comments and blank lines', () => {
            expect(file.parse('# a comment\n\nA=1\n\n')).to.deep.equal([{ key: 'A', value: '1' }]);
        });

        it('strips surrounding quotes', () => {
            expect(file.parse('A="has spaces"\nB=\'single\'\n'))
                .to.deep.equal([{ key: 'A', value: 'has spaces' }, { key: 'B', value: 'single' }]);
        });

        it('keeps equals signs inside a value', () => {
            expect(file.parse('CONN=Server=x;Key=y==\n'))
                .to.deep.equal([{ key: 'CONN', value: 'Server=x;Key=y==' }]);
        });

        it('handles an empty value', () => {
            expect(file.parse('A=\n')).to.deep.equal([{ key: 'A', value: '' }]);
        });

        it('ignores a line with no equals sign', () => {
            expect(file.parse('NOT_A_SETTING\nA=1\n')).to.deep.equal([{ key: 'A', value: '1' }]);
        });

        it('handles CRLF line endings', () => {
            expect(file.parse('A=1\r\nB=2\r\n')).to.deep.equal([{ key: 'A', value: '1' }, { key: 'B', value: '2' }]);
        });

        it('preserves comments and ordering when writing', () => {
            const original = '# header\nA=1\n# about B\nB=2\n';

            const result = file.serialize([{ key: 'A', value: 'updated' }, { key: 'B', value: '2' }], original);

            expect(result).to.equal('# header\nA=updated\n# about B\nB=2\n');
        });

        it('drops the line of a removed setting', () => {
            const original = 'A=1\nB=2\n';

            expect(file.serialize([{ key: 'A', value: '1' }], original)).to.equal('A=1\n');
        });

        it('appends new settings at the end', () => {
            const original = '# header\nA=1\n';

            expect(file.serialize([{ key: 'A', value: '1' }, { key: 'NEW', value: '2' }], original))
                .to.equal('# header\nA=1\nNEW=2\n');
        });

        it('quotes a value that needs it', () => {
            expect(file.serialize([{ key: 'A', value: 'has spaces' }], '')).to.equal('A="has spaces"\n');
            expect(file.serialize([{ key: 'A', value: 'plain' }], '')).to.equal('A=plain\n');
        });

        it('round-trips values needing quotes', () => {
            const entries = [{ key: 'A', value: 'has spaces' }, { key: 'B', value: 'with#hash' }];

            expect(file.parse(file.serialize(entries, ''))).to.deep.equal(entries);
        });

        it('round-trips a value containing double quotes', () => {
            const entries = [{ key: 'A', value: 'say "hi"' }];

            expect(file.parse(file.serialize(entries, ''))).to.deep.equal(entries);
        });

        it('round-trips a JSON value, which is common on App Service', () => {
            const entries = [{ key: 'CONFIG', value: '{"a":"b","c":[1,2]}' }];

            expect(file.parse(file.serialize(entries, ''))).to.deep.equal(entries);
        });

        it('round-trips a value containing a backslash', () => {
            const entries = [{ key: 'PATH', value: 'C:\\Program Files\\app' }];

            expect(file.parse(file.serialize(entries, ''))).to.deep.equal(entries);
        });

        it('round-trips a value containing a newline without breaking the file structure', () => {
            const entries = [{ key: 'KEY', value: 'line1\nline2' }, { key: 'AFTER', value: 'x' }];
            const serialized = file.serialize(entries, '');

            // The newline must be escaped, not emitted literally, or the following line is orphaned.
            expect(serialized.split('\n').filter(Boolean)).to.have.lengthOf(2);
            expect(file.parse(serialized)).to.deep.equal(entries);
        });

        it('does not accumulate escaping across repeated round-trips', () => {
            const entries = [{ key: 'A', value: 'say "hi"' }];

            let text = file.serialize(entries, '');
            for (let i = 0; i < 3; i++) {
                text = file.serialize(file.parse(text), text);
            }

            expect(file.parse(text)).to.deep.equal(entries);
        });

        it('still accepts a hand-written quoted path that is not valid JSON', () => {
            // A user may write this by hand; stripping the quotes is the intuitive reading.
            expect(file.parse('P="C:\\Users"\n')).to.deep.equal([{ key: 'P', value: 'C:\\Users' }]);
        });

        it('creates a file from nothing', () => {
            expect(file.serialize([{ key: 'A', value: '1' }], '')).to.equal('A=1\n');
        });
    });

    describe('format selection', () => {
        it('treats .json and .jsonc as the Functions host shape', () => {
            expect(new LocalSettingsFile('local.settings.json').isJson).to.be.true;
            expect(new LocalSettingsFile('settings.jsonc').isJson).to.be.true;
        });

        it('treats anything else as .env', () => {
            expect(new LocalSettingsFile('.env').isJson).to.be.false;
            expect(new LocalSettingsFile('.env.production').isJson).to.be.false;
        });
    });
});
