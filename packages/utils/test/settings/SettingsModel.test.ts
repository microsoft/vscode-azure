/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import {
    diffSettings, type SettingsEntry, type SettingsMap, toSettingsIndex,
} from '../../src/settings/SettingsModel';

function entry(key: string, value: string, metadata?: Record<string, string>): SettingsEntry {
    return metadata ? { key, value, metadata } : { key, value };
}

describe('SettingsModel (unit)', () => {
    describe('toSettingsIndex', () => {
        it('indexes by key', () => {
            const index = toSettingsIndex([entry('A', '1'), entry('B', '2')]);
            expect(index.get('A')?.value).to.equal('1');
            expect(index.get('B')?.value).to.equal('2');
            expect(index.size).to.equal(2);
        });

        it('keeps the last entry when keys are duplicated', () => {
            const index = toSettingsIndex([entry('A', '1'), entry('A', '2')]);
            expect(index.get('A')?.value).to.equal('2');
        });
    });

    describe('diffSettings', () => {
        it('returns no changes for identical maps', () => {
            const settings: SettingsMap = [entry('A', '1'), entry('B', '2')];
            expect(diffSettings(settings, [...settings])).to.be.empty;
        });

        it('ignores key ordering', () => {
            const before: SettingsMap = [entry('A', '1'), entry('B', '2')];
            const after: SettingsMap = [entry('B', '2'), entry('A', '1')];
            expect(diffSettings(before, after)).to.be.empty;
        });

        it('detects added, removed, and changed keys', () => {
            const before: SettingsMap = [entry('KEEP', '1'), entry('CHANGE', 'old'), entry('GONE', 'x')];
            const after: SettingsMap = [entry('KEEP', '1'), entry('CHANGE', 'new'), entry('NEW', 'y')];

            const changes = diffSettings(before, after);
            expect(changes).to.have.lengthOf(3);

            const byKey = new Map(changes.map(c => [c.key, c]));
            expect(byKey.get('CHANGE')?.kind).to.equal('changed');
            expect(byKey.get('CHANGE')?.before?.value).to.equal('old');
            expect(byKey.get('CHANGE')?.after?.value).to.equal('new');
            expect(byKey.get('NEW')?.kind).to.equal('added');
            expect(byKey.get('GONE')?.kind).to.equal('removed');
        });

        it('is case-sensitive on keys, matching Azure', () => {
            const changes = diffSettings([entry('Key', '1')], [entry('key', '1')]);
            expect(changes.map(c => c.kind).sort()).to.deep.equal(['added', 'removed']);
        });

        it('treats a metadata-only difference as changed', () => {
            const before: SettingsMap = [entry('DB', 'conn', { type: 'SQLAzure' })];
            const after: SettingsMap = [entry('DB', 'conn', { type: 'Custom' })];

            const changes = diffSettings(before, after);
            expect(changes).to.have.lengthOf(1);
            expect(changes[0].kind).to.equal('changed');
        });

        it('treats an added metadata field as changed', () => {
            const changes = diffSettings([entry('DB', 'conn')], [entry('DB', 'conn', { type: 'Custom' })]);
            expect(changes).to.have.lengthOf(1);
            expect(changes[0].kind).to.equal('changed');
        });

        it('orders added and changed entries before removed ones', () => {
            const before: SettingsMap = [entry('GONE', 'x')];
            const after: SettingsMap = [entry('NEW', 'y')];

            expect(diffSettings(before, after).map(c => c.kind)).to.deep.equal(['added', 'removed']);
        });
    });

});
