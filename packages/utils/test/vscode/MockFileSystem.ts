/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';
import type * as vscode from 'vscode';
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
        this.files.set(uri.path, typeof content === 'string' ? Buffer.from(content) : content);
    }

    readonly stat = mock.fn((uri: vscode.Uri) => {
        if (this.files.has(uri.path)) {
            return Promise.resolve({ type: 1, ctime: 0, mtime: 0, size: this.files.get(uri.path)?.byteLength ?? 0 });
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

/** Test stand-in for {@linkcode vscode.FileType}. */
export const MockFileType = {
    Unknown: 0,
    File: 1,
    Directory: 2,
    SymbolicLink: 64,
} satisfies typeof vscode.FileType;

/** Test stand-in for {@linkcode vscode.FilePermission}. */
export const MockFilePermission = {
    Readonly: 1,
} satisfies typeof vscode.FilePermission;

/** Test stand-in for {@linkcode vscode.FileChangeType}. */
export const MockFileChangeType = {
    Changed: 1,
    Created: 2,
    Deleted: 3,
} satisfies typeof vscode.FileChangeType;

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
