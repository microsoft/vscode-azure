/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FuncInstaller } from '../../src/tools/FuncInstaller';
import { createInstallerHarness, installOptions, installedWith, usePlatform } from './installerTestHelpers';

function createInstaller(onPath: readonly string[] = [], versionOutput = '5.0.0-preview.1') {
    return createInstallerHarness(FuncInstaller, onPath, { stdout: versionOutput, stderr: '' });
}

describe('FuncInstaller (unit)', () => {
    const setPlatform = usePlatform();

    describe('getVersion', () => {
        it('should read the plain version func prints', async () => {
            const { installer } = createInstaller([], '4.6.0');

            expect(await installer.getVersion('/tools/func')).to.equal('4.6.0');
        });

        it('should read a prerelease version', async () => {
            const { installer } = createInstaller();

            expect(await installer.getVersion('/tools/func')).to.equal('5.0.0-preview.1');
        });

        it('should tolerate a leading v', async () => {
            const { installer } = createInstaller([], 'v4.0.5455');

            expect(await installer.getVersion('/tools/func')).to.equal('4.0.5455');
        });

        it('should return undefined when func cannot be run', async () => {
            const { installer, spawn } = createInstaller();
            spawn.mock.mockImplementation(() => Promise.reject(new Error('ENOENT')));

            expect(await installer.getVersion('/tools/func')).to.be.undefined;
        });
    });

    describe('defaultVersionRange', () => {
        it('should use a prerelease-inclusive bound so the v5 preview satisfies it', () => {
            const { installer } = createInstaller();

            // Without the `-0`, the preview the install script produces would
            // not satisfy the tool's own default range.
            expect(installer.defaultVersionRange).to.equal('>=5.0.0-0');
        });
    });

    describe('getKnownPaths', () => {
        it('should include the install script location on Windows', () => {
            setPlatform('win32');
            const { installer } = createInstaller();

            const paths = installer.getKnownPaths().map(p => p.toLowerCase());

            expect(paths.some(p => p.includes('.azure-functions') && p.endsWith('func.exe'))).to.be.true;
        });

        it('should still include the v4 MSI location on Windows', () => {
            setPlatform('win32');
            const { installer } = createInstaller();

            const paths = installer.getKnownPaths().map(p => p.toLowerCase());

            // Independent of the host environment, so this holds on Linux in CI.
            expect(paths).to.include('c:\\program files\\microsoft\\azure functions core tools\\func.exe');
        });

        it('should include the install script location elsewhere', () => {
            setPlatform('linux');
            const { installer } = createInstaller();

            expect(installer.getKnownPaths().some(p => p.includes('.azure-functions'))).to.be.true;
        });
    });

    describe('install', () => {
        it('should run the prerelease install script on Windows', async () => {
            setPlatform('win32');
            // Present but irrelevant: v5 ships only through the script.
            const { installer, spawn } = createInstaller(['winget', 'choco', 'npm']);

            await installer.install(installOptions());

            const line = installedWith(spawn).join(' ');
            expect(line).to.include('powershell');
            expect(line).to.include('https://aka.ms/func-cli/install.ps1');
            expect(line).to.include('-Prerelease');
            expect(line).to.not.include('-Force');
        });

        it('should add -Force on Windows when upgrading an existing install', async () => {
            setPlatform('win32');
            const { installer, spawn } = createInstaller();

            await installer.install(installOptions({
                current: { executablePath: '/tools/func', version: '4.6.0' },
            }));

            expect(installedWith(spawn).join(' ')).to.include('-Force');
        });

        it('should run the prerelease install script elsewhere', async () => {
            setPlatform('linux');
            const { installer, spawn } = createInstaller(['brew', 'npm']);

            await installer.install(installOptions());

            const line = installedWith(spawn).join(' ');
            expect(line).to.include('https://aka.ms/func-cli/install.sh');
            expect(line).to.include('--prerelease');
            expect(line).to.not.include('--force');
        });

        it('should add --force elsewhere when upgrading an existing install', async () => {
            setPlatform('darwin');
            const { installer, spawn } = createInstaller();

            await installer.install(installOptions({
                current: { executablePath: '/tools/func', version: '4.6.0' },
            }));

            expect(installedWith(spawn).join(' ')).to.include('--force');
        });

        it('should warn that the install script cannot be verified', async () => {
            setPlatform('linux');
            const { installer, output } = createInstaller();

            await installer.install(installOptions());

            expect(output.warn.mock.callCount()).to.equal(1);
        });

        it('should refuse when a signature is required, since only scripts ship v5', async () => {
            setPlatform('win32');
            const { installer, spawn } = createInstaller(['winget', 'choco', 'npm']);

            await expect(installer.install(installOptions({ requireSignature: true })))
                .to.be.rejectedWith(/No way to install/);
            expect(spawn.mock.callCount()).to.equal(0);
        });
    });
});
