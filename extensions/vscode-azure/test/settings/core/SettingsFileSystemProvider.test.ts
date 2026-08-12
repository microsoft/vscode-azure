/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { SettingsFileSystemProvider, type SettingsDocumentSource } from '../../../src/settings/core/SettingsFileSystemProvider';
import { SettingsParseError } from '../../../src/settings/core/JsoncSettingsFormat';
import type { SettingsMap, SettingsSnapshot } from '../../../src/settings/core/SettingsModel';
import { createMockVsCode, type MockVsCodeResult } from '@microsoft/vscode-azure-utils/testing';

const Scheme = 'azure-settings';

function createSnapshot(overrides?: Partial<SettingsSnapshot>): SettingsSnapshot {
    return {
        entries: [{ key: 'A', value: '1' }],
        resourceName: 'myFunctionApp',
        collectionLabel: 'Application settings',
        writable: true,
        ...overrides,
    };
}

interface Harness {
    readonly code: MockVsCodeResult;
    readonly provider: SettingsFileSystemProvider;
    readonly uri: vscode.Uri;
    readonly read: ReturnType<typeof mock.fn>;
    readonly write: ReturnType<typeof mock.fn>;
    /** Swap the snapshot the source will return on its next read. */
    setSnapshot(snapshot: SettingsSnapshot): void;
}

function createHarness(initial?: SettingsSnapshot): Harness {
    const code = createMockVsCode();
    let snapshot = initial ?? createSnapshot();

    const read = mock.fn((_uri: vscode.Uri) => Promise.resolve(snapshot));
    const write = mock.fn((_uri: vscode.Uri, _entries: SettingsMap) => Promise.resolve());

    const source: SettingsDocumentSource = {
        read: uri => read(uri),
        write: (uri, entries) => write(uri, entries),
    };

    const provider = new SettingsFileSystemProvider(code.vscode, source);

    const uri = code.vscode.Uri.from({ scheme: Scheme, path: '/abc/myFunctionApp.appSettings.jsonc' });

    return {
        code, provider, uri, read, write,
        setSnapshot: next => { snapshot = next; },
    };
}

function readText(provider: SettingsFileSystemProvider, uri: vscode.Uri): Promise<string> {
    return provider.readFile(uri).then(bytes => Buffer.from(bytes).toString('utf8'));
}

describe('SettingsFileSystemProvider (unit)', () => {
    let harness: Harness;

    beforeEach(() => {
        harness = createHarness();
    });

    describe('stat', () => {
        it('reports a file whose size matches the serialized text', async () => {
            const stat = await harness.provider.stat(harness.uri);
            const text = await readText(harness.provider, harness.uri);

            expect(stat.type).to.equal(harness.code.vscode.FileType.File);
            expect(stat.size).to.equal(Buffer.byteLength(text, 'utf8'));
        });

        it('leaves permissions undefined for a writable collection', async () => {
            const stat = await harness.provider.stat(harness.uri);
            expect(stat.permissions).to.be.undefined;
        });

        it('marks a non-writable collection read-only', async () => {
            harness.setSnapshot(createSnapshot({ writable: false }));

            const stat = await harness.provider.stat(harness.uri);
            expect(stat.permissions).to.equal(harness.code.vscode.FilePermission.Readonly);
        });

        it('translates an unresolvable URI into FileNotFound', async () => {
            const h = createHarness();
            h.read.mock.mockImplementation(() => Promise.reject(new Error('no such resource')));

            try {
                await h.provider.stat(h.uri);
                expect.fail('expected a FileSystemError');
            } catch (error) {
                expect((error as vscode.FileSystemError).code).to.equal('FileNotFound');
                expect((error as Error).message).to.contain('no such resource');
            }
        });
    });

    describe('readFile', () => {
        it('returns the serialized snapshot', async () => {
            const text = await readText(harness.provider, harness.uri);
            expect(text).to.contain('"A": "1"');
        });

        it('reuses the snapshot fetched by a preceding stat, so opening costs one round trip', async () => {
            await harness.provider.stat(harness.uri);
            await harness.provider.readFile(harness.uri);

            expect(harness.read.mock.callCount()).to.equal(1);
        });

        it('fetches fresh data once the freshness window has elapsed', async () => {
            const code = createMockVsCode();
            let snapshot = createSnapshot();
            const read = mock.fn(() => Promise.resolve(snapshot));
            const provider = new SettingsFileSystemProvider(
                code.vscode,
                { read: () => read(), write: () => Promise.resolve() },
                { freshnessWindowMs: 0 },
            );
            const uri = code.vscode.Uri.from({ scheme: Scheme, path: '/x/y.jsonc' });

            await provider.readFile(uri);
            snapshot = createSnapshot({ entries: [{ key: 'A', value: 'updated' }] });
            const text = Buffer.from(await provider.readFile(uri)).toString('utf8');

            expect(read.mock.callCount()).to.equal(2);
            expect(text).to.contain('"A": "updated"');
        });
    });

    describe('writeFile', () => {
        it('writes the parsed document as the complete new contents', async () => {
            await harness.provider.readFile(harness.uri);
            await harness.provider.writeFile(
                harness.uri,
                Buffer.from('{ "A": "1", "B": "2" }', 'utf8'),
                { create: false, overwrite: true },
            );

            expect(harness.write.mock.callCount()).to.equal(1);
            expect(harness.write.mock.calls[0].arguments[1]).to.deep.equal([
                { key: 'A', value: '1' },
                { key: 'B', value: '2' },
            ]);
        });

        it('deletes a setting by omitting it, rather than merging', async () => {
            harness.setSnapshot(createSnapshot({ entries: [{ key: 'A', value: '1' }, { key: 'B', value: '2' }] }));
            await harness.provider.readFile(harness.uri);

            await harness.provider.writeFile(harness.uri, Buffer.from('{ "A": "1" }', 'utf8'), { create: false, overwrite: true });

            expect(harness.write.mock.calls[0].arguments[1]).to.deep.equal([{ key: 'A', value: '1' }]);
        });

        it('refuses to write a read-only collection', async () => {
            harness.setSnapshot(createSnapshot({ writable: false }));

            try {
                await harness.provider.writeFile(harness.uri, Buffer.from('{}', 'utf8'), { create: false, overwrite: true });
                expect.fail('expected a FileSystemError');
            } catch (error) {
                expect((error as vscode.FileSystemError).code).to.equal('NoPermissions');
            }
            expect(harness.write.mock.callCount()).to.equal(0);
        });

        it('surfaces a parse error without writing anything', async () => {
            await harness.provider.readFile(harness.uri);

            try {
                await harness.provider.writeFile(harness.uri, Buffer.from('{ "A": ', 'utf8'), { create: false, overwrite: true });
                expect.fail('expected a SettingsParseError');
            } catch (error) {
                expect(error).to.be.instanceOf(SettingsParseError);
            }
            expect(harness.write.mock.callCount()).to.equal(0);
        });

        it('fires a change event so other views re-read', async () => {
            const events: vscode.FileChangeEvent[][] = [];
            harness.provider.onDidChangeFile(e => events.push([...e]));

            await harness.provider.readFile(harness.uri);
            await harness.provider.writeFile(harness.uri, Buffer.from('{ "A": "2" }', 'utf8'), { create: false, overwrite: true });

            expect(events).to.have.lengthOf(1);
            expect(events[0][0].type).to.equal(harness.code.vscode.FileChangeType.Changed);
            expect(events[0][0].uri.toString()).to.equal(harness.uri.toString());
        });

        it('serves the written values on the next read without another fetch', async () => {
            await harness.provider.readFile(harness.uri);
            await harness.provider.writeFile(harness.uri, Buffer.from('{ "A": "2" }', 'utf8'), { create: false, overwrite: true });

            const text = await readText(harness.provider, harness.uri);

            expect(text).to.contain('"A": "2"');
            expect(harness.read.mock.callCount()).to.equal(1);
        });

        describe('read-only collections', () => {
            beforeEach(() => {
                harness.setSnapshot(createSnapshot({ writable: false }));
            });

            it('reports the document as read-only', async () => {
                const stat = await harness.provider.stat(harness.uri);

                expect(stat.permissions).to.equal(harness.code.vscode.FilePermission.Readonly);
            });

            it('rejects writes without calling the source', async () => {
                await harness.provider.readFile(harness.uri);

                try {
                    await harness.provider.writeFile(
                        harness.uri,
                        Buffer.from('{ "A": "brand-new" }', 'utf8'),
                        { create: false, overwrite: true },
                    );
                    expect.fail('expected an error');
                } catch (error) {
                    expect(error).to.have.property('code', 'NoPermissions');
                }
                expect(harness.write.mock.callCount()).to.equal(0);
            });
        });
    });

    describe('unsupported operations', () => {
        it('rejects readDirectory, since a settings URI names a document', () => {
            expect(() => { harness.provider.readDirectory(harness.uri); })
                .to.throw().with.property('code', 'FileNotFound');
        });

        it('rejects createDirectory, delete, and rename', () => {
            expect(() => { harness.provider.createDirectory(harness.uri); })
                .to.throw().with.property('code', 'NoPermissions');
            expect(() => { harness.provider.delete(harness.uri); })
                .to.throw().with.property('code', 'NoPermissions');
            expect(() => { harness.provider.rename(harness.uri); })
                .to.throw().with.property('code', 'NoPermissions');
        });

        it('returns a disposable from watch', () => {
            expect(() => { harness.provider.watch().dispose(); }).to.not.throw();
        });
    });

});
