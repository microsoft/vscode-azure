/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ConcreteAzureNode, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { createMockVsCode, type MockVsCodeResult } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import type { SettingsAdapter } from '../../src/settings/SettingsAdapter';
import { JsoncSettingsFormat, SettingsFileSystemProvider, SettingsParseError } from '../../src/settings/SettingsFileSystemProvider';
import type { SettingsMap, SettingsSnapshot } from '../../src/settings/SettingsModel';
import { SettingsUri } from '../../src/settings/SettingsUri';
import { getSettingsNodes } from '../../src/tree/resources/settings/SettingsNode';
import { makeSettingsResource, makeSettingsSnapshot } from './mockSettings';

interface HarnessOptions {
    readonly freshnessWindowMs?: number;
    /** When false, the tree resolves nothing -- the window-reload case. */
    readonly inTree?: boolean;
}

interface Harness {
    readonly code: MockVsCodeResult;
    readonly provider: SettingsFileSystemProvider;
    readonly uri: vscode.Uri;
    readonly node: ConcreteAzureNode;
    readonly resource: GenericResource;
    readonly read: ReturnType<typeof mock.fn>;
    readonly write: ReturnType<typeof mock.fn>;
    readonly invalidate: ReturnType<typeof mock.fn>;
    /** Swap the snapshot the adapter will return on its next read. */
    setSnapshot(snapshot: SettingsSnapshot): void;
}

function createHarness(options?: HarnessOptions): Harness {
    const code = createMockVsCode();
    let snapshot = makeSettingsSnapshot({ entries: [{ key: 'A', value: '1' }] });

    const read = mock.fn((_resource: GenericResource) => Promise.resolve(snapshot));
    const write = mock.fn((_resource: GenericResource, _entries: SettingsMap) => Promise.resolve());

    const adapter: SettingsAdapter = {
        label: 'Application Settings',
        canHandle: () => true,
        read: resource => read(resource),
        write: (resource, entries) => write(resource, entries),
    };

    const resource = makeSettingsResource();
    const [node] = getSettingsNodes(resource, adapter);
    const key = AzureNodeId.from(node).toString();

    const invalidate = mock.fn();
    const tree = {
        get: (requested: string) => ((options?.inTree ?? true) && requested === key ? node : undefined),
        invalidate,
    };

    const provider = new SettingsFileSystemProvider(
        code.vscode,
        tree as never,
        options?.freshnessWindowMs === undefined ? undefined : { freshnessWindowMs: options.freshnessWindowMs },
    );

    return {
        code, provider, node, resource, read, write, invalidate,
        uri: SettingsUri.from(code.vscode, node),
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

    describe('resolving a URI', () => {
        it('hands the adapter the resource the tree already loaded, not a copy', async () => {
            await harness.provider.readFile(harness.uri);

            expect(harness.read.mock.callCount()).to.equal(1);
            expect(harness.read.mock.calls[0].arguments[0]).to.equal(harness.resource);
        });

        it('fails clearly when the node is no longer in the tree', async () => {
            const h = createHarness({ inTree: false });

            const error: Error = await expect(h.provider.stat(h.uri)).to.be.rejectedWith(Error, /no longer available/);

            expect(error).to.have.property('code', 'FileNotFound');
            expect(h.read.mock.callCount()).to.equal(0);
        });

    });

    describe('stat', () => {
        it('reports a file whose size matches the serialized text', async () => {
            const stat = await harness.provider.stat(harness.uri);
            const text = await readText(harness.provider, harness.uri);

            expect(stat.type).to.equal(harness.code.vscode.FileType.File);
            expect(stat.size).to.equal(Buffer.byteLength(text, 'utf8'));
        });

        it('leaves permissions undefined for writable settings', async () => {
            const stat = await harness.provider.stat(harness.uri);
            expect(stat.permissions).to.be.undefined;
        });

        it('marks non-writable settings read-only', async () => {
            harness.setSnapshot(makeSettingsSnapshot({ writable: false }));

            const stat = await harness.provider.stat(harness.uri);
            expect(stat.permissions).to.equal(harness.code.vscode.FilePermission.Readonly);
        });

        it('translates an adapter failure into FileNotFound, preserving the cause', async () => {
            harness.read.mock.mockImplementation(() => Promise.reject(new Error('no such resource')));

            const error: Error = await expect(harness.provider.stat(harness.uri))
                .to.be.rejectedWith(Error, /no such resource/);

            expect(error).to.have.property('code', 'FileNotFound');
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
            const h = createHarness({ freshnessWindowMs: 0 });

            await h.provider.readFile(h.uri);
            h.setSnapshot(makeSettingsSnapshot({ entries: [{ key: 'A', value: 'updated' }] }));
            const text = await readText(h.provider, h.uri);

            expect(h.read.mock.callCount()).to.equal(2);
            expect(text).to.contain('"A": "updated"');
        });
    });

    describe('writeFile', () => {
        it('writes the parsed document as the complete new settings', async () => {
            await harness.provider.readFile(harness.uri);
            await harness.provider.writeFile(
                harness.uri,
                Buffer.from('{ "A": "1", "B": "2" }', 'utf8'),
                { create: false, overwrite: true },
            );

            expect(harness.write.mock.callCount()).to.equal(1);
            expect(harness.write.mock.calls[0].arguments[0]).to.equal(harness.resource);
            expect(harness.write.mock.calls[0].arguments[1]).to.deep.equal([
                { key: 'A', value: '1' },
                { key: 'B', value: '2' },
            ]);
        });

        it('deletes a setting by omitting it, rather than merging', async () => {
            harness.setSnapshot(makeSettingsSnapshot({ entries: [{ key: 'A', value: '1' }, { key: 'B', value: '2' }] }));
            await harness.provider.readFile(harness.uri);

            await harness.provider.writeFile(harness.uri, Buffer.from('{ "A": "1" }', 'utf8'), { create: false, overwrite: true });

            expect(harness.write.mock.calls[0].arguments[1]).to.deep.equal([{ key: 'A', value: '1' }]);
        });

        it('invalidates the settings node so the tree reflects the write', async () => {
            await harness.provider.readFile(harness.uri);
            await harness.provider.writeFile(harness.uri, Buffer.from('{ "A": "2" }', 'utf8'), { create: false, overwrite: true });

            expect(harness.invalidate.mock.calls[0].arguments[0]).to.equal(harness.node);
        });

        it('refuses to write read-only settings', async () => {
            harness.setSnapshot(makeSettingsSnapshot({ writable: false }));

            const error: Error = await expect(harness.provider.writeFile(
                harness.uri,
                Buffer.from('{ "A": "brand-new" }', 'utf8'),
                { create: false, overwrite: true },
            )).to.be.rejectedWith(Error);

            expect(error).to.have.property('code', 'NoPermissions');
            expect(harness.write.mock.callCount()).to.equal(0);
        });

        it('surfaces a parse error without writing anything', async () => {
            await harness.provider.readFile(harness.uri);

            await expect(harness.provider.writeFile(
                harness.uri,
                Buffer.from('{ "A": ', 'utf8'),
                { create: false, overwrite: true },
            )).to.be.rejectedWith(SettingsParseError);

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

    describe('JSONC format', () => {
        const createFormat = (): JsoncSettingsFormat => new JsoncSettingsFormat(createMockVsCode().vscode);

        describe('serialize', () => {
            it('renders entries as a JSON object', () => {
                const text = createFormat().serialize(makeSettingsSnapshot({
                    resourceName: 'myFunctionApp',
                    label: 'Application settings',
                    entries: [{ key: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }],
                }));

                expect(text).to.contain('"FUNCTIONS_WORKER_RUNTIME": "node"');
            });

            it('serializes __proto__ as a setting name', () => {
                const format = createFormat();
                const snapshot = makeSettingsSnapshot({
                    entries: [{ key: '__proto__', value: 'secret' }],
                });

                expect(format.parse(format.serialize(snapshot))).to.deep.equal(snapshot.entries);
            });

            it('names the resource and collection in the header', () => {
                const text = createFormat().serialize(makeSettingsSnapshot({
                    resourceName: 'myFunctionApp',
                    label: 'Application settings',
                }));

                expect(text).to.contain('// Application settings for \'myFunctionApp\'.');
            });

            it('explains last-writer-wins save semantics when writable', () => {
                expect(createFormat().serialize(makeSettingsSnapshot()))
                    .to.contain('overwrites any changes made elsewhere');
            });

            it('warns that deployments may overwrite live edits', () => {
                expect(createFormat().serialize(makeSettingsSnapshot()))
                    .to.contain('Deployments and infrastructure-as-code tools may overwrite edits made here.');
            });

            it('says the document is read-only instead when it is not writable', () => {
                const text = createFormat().serialize(makeSettingsSnapshot({ writable: false }));

                expect(text).to.contain('read-only');
                expect(text).to.not.contain('Removing a setting deletes it.');
            });
        });

        describe('parse', () => {
            it('reads a plain object of settings', () => {
                expect(createFormat().parse('{ "A": "1", "B": "2" }')).to.deep.equal([
                    { key: 'A', value: '1' },
                    { key: 'B', value: '2' },
                ]);
            });

            it('ignores comments, including the generated header', () => {
                expect(createFormat().parse('// a header\n// another line\n{ "A": "1" }'))
                    .to.deep.equal([{ key: 'A', value: '1' }]);
            });

            it('preserves document order', () => {
                expect(createFormat().parse('{ "Z": "1", "A": "2" }').map(entry => entry.key))
                    .to.deep.equal(['Z', 'A']);
            });

            it('accepts an empty object', () => {
                expect(createFormat().parse('{}')).to.be.empty;
            });

            it('tolerates a trailing comma', () => {
                expect(createFormat().parse('{ "A": "1", }')).to.deep.equal([{ key: 'A', value: '1' }]);
            });

            it('throws with a position for malformed JSON', () => {
                expect(() => createFormat().parse('{ "A": '))
                    .to.throw(SettingsParseError, /not valid JSON/);
            });

            it('throws when the root is not an object', () => {
                expect(() => createFormat().parse('["A"]'))
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
                    expect(parseError.message).to.contain('MySetting');
                    expect(parseError.message).to.contain('MYSETTING');
                    expect(text.slice(parseError.offset, parseError.offset + parseError.length)).to.equal('"MYSETTING"');
                }
            });

            it('still accepts names that differ by more than capitalization', () => {
                expect(createFormat().parse('{ "A_ONE": "1", "A_TWO": "2" }')).to.deep.equal([
                    { key: 'A_ONE', value: '1' },
                    { key: 'A_TWO', value: '2' },
                ]);
            });

            it('rejects a non-string value', () => {
                expect(() => createFormat().parse('{ "PORT": 8080 }'))
                    .to.throw(SettingsParseError, /must be a quoted string/);
            });

            it('rejects null and boolean values', () => {
                expect(() => createFormat().parse('{ "A": null }')).to.throw(SettingsParseError);
                expect(() => createFormat().parse('{ "A": true }')).to.throw(SettingsParseError);
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

        it('round-trips entries exactly', () => {
            const format = createFormat();
            const entries: SettingsMap = [
                { key: 'A', value: '1' },
                { key: 'WITH SPACES', value: 'has "quotes" and \\ backslash' },
                { key: 'EMPTY', value: '' },
                { key: 'MULTILINE', value: 'line1\nline2' },
                { key: 'UNICODE', value: 'caf\u00e9' },
            ];

            expect(format.parse(format.serialize(makeSettingsSnapshot({ entries })))).to.deep.equal(entries);
        });
    });
});
