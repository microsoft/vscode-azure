/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';
import type * as vscode from 'vscode';

/**
 * In-memory mock of `vscode.workspace.fs`.
 *
 * All operations work against an internal `Map<string, Uint8Array>`
 * keyed by the URI's `path`.
 *
 * Tests can pre-populate the file system via {@linkcode addFile} or
 * inspect it via {@linkcode files}. Every method is a `mock.fn()`
 * for call-count assertions.
 */
export class MockFileSystem {
    /** Backing store keyed by URI path. */
    readonly files = new Map<string, Uint8Array>();
    /** Tracks directories created via {@linkcode createDirectory}. */
    readonly directories = new Set<string>();

    /** Pre-populate a file so {@linkcode stat} and {@linkcode readFile} find it. */
    addFile(uri: vscode.Uri, content: Uint8Array | string = new Uint8Array()): void {
        this.files.set(uri.path, typeof content === 'string' ? Buffer.from(content) : content);
    }

    readonly stat = mock.fn((uri: vscode.Uri) => {
        if (this.files.has(uri.path)) {
            return Promise.resolve({ type: 1, ctime: 0, mtime: 0, size: this.files.get(uri.path)?.byteLength ?? 0 });
        } else if (this.directories.has(uri.path)) {
            return Promise.resolve({ type: 2, ctime: 0, mtime: 0, size: 0 });
        }
        return Promise.reject(Object.assign(new Error(`File not found: ${uri.path}`), { code: 'FileNotFound' }));
    });

    readonly readFile = mock.fn((uri: vscode.Uri) => {
        const data = this.files.get(uri.path);
        if (data) {
            return Promise.resolve(data);
        }
        return Promise.reject(Object.assign(new Error(`File not found: ${uri.path}`), { code: 'FileNotFound' }));
    });

    /** Lists immediate file and directory children of a directory. */
    readonly readDirectory = mock.fn((uri: vscode.Uri): Promise<[string, vscode.FileType][]> => {
        const prefix = uri.path.endsWith('/') ? uri.path : `${uri.path}/`;
        const children = new Map<string, vscode.FileType>();

        for (const filePath of this.files.keys()) {
            if (!filePath.startsWith(prefix)) {
                continue;
            }
            const remainder = filePath.slice(prefix.length);
            const [name, nested] = remainder.split('/', 2);
            if (name) {
                children.set(name, nested ? 2 : 1);
            }
        }

        for (const directoryPath of this.directories) {
            if (!directoryPath.startsWith(prefix)) {
                continue;
            }
            const remainder = directoryPath.slice(prefix.length);
            const [name] = remainder.split('/', 1);
            if (name) {
                children.set(name, 2);
            }
        }

        if (children.size === 0 && !this.directories.has(uri.path)) {
            return Promise.reject(Object.assign(new Error(`File not found: ${uri.path}`), { code: 'FileNotFound' }));
        }

        return Promise.resolve([...children.entries()].sort(([left], [right]) => left.localeCompare(right)));
    });

    readonly writeFile = mock.fn((uri: vscode.Uri, content: Uint8Array) => {
        this.files.set(uri.path, content);
        return Promise.resolve();
    });

    readonly createDirectory = mock.fn((uri: vscode.Uri) => {
        this.directories.add(uri.path);
        return Promise.resolve();
    });

    readonly copy = mock.fn((source: vscode.Uri, target: vscode.Uri) => {
        const data = this.files.get(source.path);
        if (data) {
            this.files.set(target.path, data);
        }
        return Promise.resolve();
    });

    readonly delete = mock.fn((uri: vscode.Uri) => {
        this.files.delete(uri.path);
        this.directories.delete(uri.path);
        return Promise.resolve();
    });
}
