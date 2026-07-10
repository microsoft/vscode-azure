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
        return Promise.reject(new Error(`File not found: ${uri.path}`));
    });

    readonly readFile = mock.fn((uri: vscode.Uri) => {
        const data = this.files.get(uri.path);
        if (data) {
            return Promise.resolve(data);
        }
        return Promise.reject(new Error(`File not found: ${uri.path}`));
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
