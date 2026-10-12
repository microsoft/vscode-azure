/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { dirname } from '../../src/vscode/fsHelpers';
import type { Satisfies } from '../../src/types/Satisfies';

/** Standard error codes produced by {@linkcode vscode.FileSystemError}. */
export type MockFileSystemErrorCode =
    | 'FileExists'
    | 'FileIsADirectory'
    | 'FileNotADirectory'
    | 'FileNotFound'
    | 'NoPermissions'
    | 'Unavailable';

const errorMessages: Record<MockFileSystemErrorCode, string> = {
    FileExists: 'File exists',
    FileIsADirectory: 'File is a directory',
    FileNotADirectory: 'File is not a directory',
    FileNotFound: 'File not found',
    NoPermissions: 'No permissions',
    Unavailable: 'Unavailable',
};

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
    /** Tracks symbolic links and the file type they point to. */
    readonly symbolicLinks = new Map<string, vscode.FileType>();

    /**
     * Creates a filesystem error with the same `code` contract used by
     * {@linkcode vscode.FileSystemError}.
     */
    static createError(code: MockFileSystemErrorCode, uri: vscode.Uri): vscode.FileSystemError {
        return Object.assign(new Error(`${errorMessages[code]}: ${uri.path}`), { code });
    }

    /** Creates the standard missing-file error used by filesystem operations. */
    static fileNotFound(uri: vscode.Uri): vscode.FileSystemError {
        return MockFileSystem.createError('FileNotFound', uri);
    }

    /** Pre-populate a file so {@linkcode stat} and {@linkcode readFile} find it. */
    addFile(uri: vscode.Uri, content: Uint8Array | string = new Uint8Array()): void {
        this.addParentDirectories(uri);
        this.files.set(uri.path, typeof content === 'string' ? Buffer.from(content) : content);
    }

    /** Pre-populate a directory so {@linkcode stat} and {@linkcode readDirectory} find it. */
    addDirectory(uri: vscode.Uri): void {
        this.addParentDirectories(uri);
        this.directories.add(uri.path);
    }

    /** Pre-populate a symbolic link without following it to a target. */
    addSymbolicLink(uri: vscode.Uri, targetType: vscode.FileType): void {
        this.addParentDirectories(uri);
        this.symbolicLinks.set(uri.path, targetType);
    }

    readonly stat = mock.fn((uri: vscode.Uri) => {
        if (this.files.has(uri.path)) {
            return Promise.resolve({ type: 1, ctime: 0, mtime: 0, size: this.files.get(uri.path)?.byteLength ?? 0 });
        } else if (this.symbolicLinks.has(uri.path)) {
            return Promise.resolve({ type: 64 | (this.symbolicLinks.get(uri.path) ?? 0), ctime: 0, mtime: 0, size: 0 });
        } else if (this.directories.has(uri.path)) {
            return Promise.resolve({ type: 2, ctime: 0, mtime: 0, size: 0 });
        }
        return Promise.reject(MockFileSystem.fileNotFound(uri));
    });

    readonly readFile = mock.fn((uri: vscode.Uri) => {
        const data = this.files.get(uri.path);
        if (data) {
            return Promise.resolve(data);
        }
        return Promise.reject(MockFileSystem.fileNotFound(uri));
    });

    readonly writeFile = mock.fn((uri: vscode.Uri, content: Uint8Array) => {
        this.addFile(uri, content);
        return Promise.resolve();
    });

    readonly createDirectory = mock.fn((uri: vscode.Uri) => {
        this.addDirectory(uri);
        return Promise.resolve();
    });

    readonly readDirectory = mock.fn((uri: vscode.Uri) => {
        if (!this.directories.has(uri.path)) {
            return Promise.reject(MockFileSystem.fileNotFound(uri));
        }

        const prefix = uri.path.endsWith('/') ? uri.path : `${uri.path}/`;
        const entries = new Map<string, vscode.FileType>();
        for (const path of this.directories) {
            this.addDirectChild(entries, prefix, path, MockFileType.Directory);
        }
        for (const path of this.files.keys()) {
            this.addDirectChild(entries, prefix, path, MockFileType.File);
        }
        for (const [path, targetType] of this.symbolicLinks) {
            this.addDirectChild(entries, prefix, path, MockFileType.SymbolicLink | targetType);
        }
        return Promise.resolve([...entries]);
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
        this.symbolicLinks.delete(uri.path);
        return Promise.resolve();
    });

    private addParentDirectories(uri: vscode.Uri): void {
        let current = uri;
        let parent = dirname(current);
        // `dirname` is a fixed point at the root, which is what stops the walk.
        while (parent.path !== current.path) {
            this.directories.add(parent.path);
            current = parent;
            parent = dirname(current);
        }
    }

    private addDirectChild(
        entries: Map<string, vscode.FileType>,
        prefix: string,
        path: string,
        type: vscode.FileType,
    ): void {
        if (!path.startsWith(prefix)) {
            return;
        }
        const relativePath = path.slice(prefix.length);
        if (relativePath && !relativePath.includes('/')) {
            entries.set(relativePath, type);
        }
    }
}

/* eslint-disable @typescript-eslint/no-unsafe-enum-assignment -- numeric stand-ins avoid a runtime dependency on vscode */
/** Test stand-in for {@linkcode vscode.FileType}. */
export const MockFileType: typeof vscode.FileType = {
    Unknown: 0,
    File: 1,
    Directory: 2,
    SymbolicLink: 64,
};

/** Test stand-in for {@linkcode vscode.FilePermission}. */
export const MockFilePermission: typeof vscode.FilePermission = {
    Readonly: 1,
};

/** Test stand-in for {@linkcode vscode.FileChangeType}. */
export const MockFileChangeType: typeof vscode.FileChangeType = {
    Changed: 1,
    Created: 2,
    Deleted: 3,
};
/* eslint-enable @typescript-eslint/no-unsafe-enum-assignment */

/**
 * Test stand-in for {@linkcode vscode.FileSystemError}.
 *
 * The editor identifies these errors by their {@linkcode MockFileSystemError.code code}, not by
 * class identity, so a `FileSystemProvider` under test must be asserted the same way -- which is
 * also how {@linkcode MockFileSystem.createError} shapes the errors it throws. Each static factory
 * mirrors the real API, including its dual `Uri | string | undefined` argument.
 */
export class MockFileSystemError extends Error implements vscode.FileSystemError {
    public constructor(messageOrUri?: string | vscode.Uri, public readonly code: string = 'Unknown') {
        super(typeof messageOrUri === 'string' || messageOrUri === undefined ? messageOrUri : messageOrUri.toString());
        this.name = 'FileSystemError';
    }

    public static FileNotFound(messageOrUri?: string | vscode.Uri): MockFileSystemError {
        return new MockFileSystemError(messageOrUri, 'FileNotFound');
    }

    public static FileExists(messageOrUri?: string | vscode.Uri): MockFileSystemError {
        return new MockFileSystemError(messageOrUri, 'FileExists');
    }

    public static FileNotADirectory(messageOrUri?: string | vscode.Uri): MockFileSystemError {
        return new MockFileSystemError(messageOrUri, 'FileNotADirectory');
    }

    public static FileIsADirectory(messageOrUri?: string | vscode.Uri): MockFileSystemError {
        return new MockFileSystemError(messageOrUri, 'FileIsADirectory');
    }

    public static NoPermissions(messageOrUri?: string | vscode.Uri): MockFileSystemError {
        return new MockFileSystemError(messageOrUri, 'NoPermissions');
    }

    public static Unavailable(messageOrUri?: string | vscode.Uri): MockFileSystemError {
        return new MockFileSystemError(messageOrUri, 'Unavailable');
    }
}

// Compile-time check: the error type is mutually assignable to its vscode counterpart, so the
// shape is faithful in both directions.
/* eslint-disable @typescript-eslint/no-unused-vars */
type ForwardCheckFileSystemError = Satisfies<MockFileSystemError, vscode.FileSystemError>;
type ReverseCheckFileSystemError = Satisfies<vscode.FileSystemError, MockFileSystemError>;
/* eslint-enable @typescript-eslint/no-unused-vars */
