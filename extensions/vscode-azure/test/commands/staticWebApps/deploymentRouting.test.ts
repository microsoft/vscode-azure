/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { resolvePosixProjectPath, resolveWindowsProjectPath } from '../../../src/commands/staticWebApps/deploymentRouting';

describe('deploymentRouting path resolution (unit)', () => {
    describe('resolveWindowsProjectPath', () => {
        // These mirror Go's filepath.IsAbs + filepath.Join for Windows exactly (verified against
        // the Go standard library's own algorithm), which is *not* the same as Node's
        // path.win32.resolve/isAbsolute in every case. Factored out as a pure, string-only
        // function (no vscode/fs dependency) specifically so these can run on any host, including
        // this suite's actual POSIX CI/sandbox -- path.win32 is available on every platform.
        const iacFolderFsPath = 'C:\\workspace';

        it('should treat a rooted-without-volume path ("/foo") as relative, joining it under the project root (Go: filepath.IsAbs("/foo") is false on Windows)', () => {
            expect(resolveWindowsProjectPath(iacFolderFsPath, '/foo')).to.equal('C:\\workspace\\foo');
        });

        it('should treat a drive-relative path ("C:foo", no separator after the colon) as relative, joining it under the project root as a literal segment (Go: filepath.IsAbs("C:foo") is false)', () => {
            expect(resolveWindowsProjectPath(iacFolderFsPath, 'C:foo')).to.equal('C:\\workspace\\C:foo');
        });

        it('should treat a drive-absolute path ("C:\\foo") as absolute, used unchanged and independent of the project root', () => {
            expect(resolveWindowsProjectPath(iacFolderFsPath, 'C:\\foo')).to.equal('C:\\foo');
        });

        it('should treat a UNC path ("\\\\server\\share\\x") as absolute, used unchanged and independent of the project root', () => {
            expect(resolveWindowsProjectPath(iacFolderFsPath, '\\\\server\\share\\x')).to.equal('\\\\server\\share\\x');
        });

        it('should treat a device path ("\\\\.\\C:\\foo") as absolute, used unchanged', () => {
            expect(resolveWindowsProjectPath(iacFolderFsPath, '\\\\.\\C:\\foo')).to.equal('\\\\.\\C:\\foo');
        });

        it('should resolve a normal relative path against the project root', () => {
            expect(resolveWindowsProjectPath(iacFolderFsPath, 'frontend\\app')).to.equal('C:\\workspace\\frontend\\app');
        });

        it('should permit ".." to traverse above the project root, matching Go\'s filepath.Join/Clean rather than rejecting it', () => {
            expect(resolveWindowsProjectPath(iacFolderFsPath, '..\\outside')).to.equal('C:\\outside');
        });

        it('should accept forward slashes as separators too (Windows accepts both)', () => {
            expect(resolveWindowsProjectPath(iacFolderFsPath, 'frontend/app')).to.equal('C:\\workspace\\frontend\\app');
        });
    });

    describe('resolvePosixProjectPath', () => {
        // POSIX has no divergence to correct for -- Node's path.posix.isAbsolute already matches
        // Go's filepath.IsAbs on POSIX exactly (a leading "/" and nothing else).
        const iacFolderFsPath = '/workspace';

        it('should treat a leading-slash path ("/foo") as absolute, used unchanged and independent of the project root', () => {
            expect(resolvePosixProjectPath(iacFolderFsPath, '/foo')).to.equal('/foo');
        });

        it('should treat a Windows drive-letter form ("C:foo") as a plain relative path segment, since POSIX has no drive letters', () => {
            expect(resolvePosixProjectPath(iacFolderFsPath, 'C:foo')).to.equal('/workspace/C:foo');
        });

        it('should treat a Windows drive-absolute form ("C:\\foo") as a plain relative path segment containing a literal backslash, since POSIX backslash is not a separator', () => {
            expect(resolvePosixProjectPath(iacFolderFsPath, 'C:\\foo')).to.equal('/workspace/C:\\foo');
        });

        it('should resolve a normal relative path against the project root', () => {
            expect(resolvePosixProjectPath(iacFolderFsPath, 'frontend/app')).to.equal('/workspace/frontend/app');
        });

        it('should permit ".." to traverse above the project root, matching Go\'s filepath.Join/Clean rather than rejecting it', () => {
            expect(resolvePosixProjectPath(iacFolderFsPath, '../outside')).to.equal('/outside');
        });
    });
});
