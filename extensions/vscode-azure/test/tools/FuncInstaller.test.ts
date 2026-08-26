/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FuncInstaller } from '../../src/tools/FuncInstaller';
import { createInstallerHarness, installOptions, installedWith, usePlatform } from './installerTestHelpers';

function createInstaller(onPath: readonly string[] = [], versionOutput = '4.6.0') {
    return createInstallerHarness(FuncInstaller, onPath, { stdout: versionOutput, stderr: '' });
}

describe('FuncInstaller (unit)', () => {
    const setPlatform = usePlatform();

    describe('getVersion', () => {
        it('should read the plain version func prints', async () => {
            const { installer } = createInstaller();

            expect(await installer.getVersion('/tools/func')).to.equal('4.6.0');
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

    describe('getKnownPaths', () => {
        it('should include the MSI location on Windows', () => {
            setPlatform('win32');
            const { installer } = createInstaller();

            const paths = installer.getKnownPaths().map(p => p.toLowerCase());

            // Independent of the host's own environment, so this holds when the
            // suite runs on Linux in CI.
            expect(paths).to.include('c:\\program files\\microsoft\\azure functions core tools\\func.exe');
        });

        it('should include the npm global bin elsewhere', () => {
            setPlatform('linux');
            const { installer } = createInstaller();

            expect(installer.getKnownPaths()).to.include('/usr/local/bin/func');
        });
    });

    describe('install', () => {
        it('should prefer winget on Windows', async () => {
            setPlatform('win32');
            const { installer, spawn } = createInstaller(['winget', 'choco', 'npm']);

            await installer.install(installOptions());

            expect(installedWith(spawn)).to.deep.equal([
                'winget', 'install', 'Microsoft.Azure.FunctionsCoreTools', '--accept-source-agreements',
            ]);
        });

        it('should fall back to choco on Windows when winget is unavailable', async () => {
            setPlatform('win32');
            const { installer, spawn } = createInstaller(['choco', 'npm']);

            await installer.install(installOptions());

            expect(installedWith(spawn)).to.deep.equal(['choco', 'upgrade', 'azure-functions-core-tools']);
        });

        it('should use the azure/functions tap on macOS', async () => {
            setPlatform('darwin');
            const { installer, spawn } = createInstaller(['brew', 'npm']);

            await installer.install(installOptions());

            // Fully qualified, because the formula is not in brew core.
            expect(installedWith(spawn)).to.deep.equal([
                'brew', 'install', 'azure/functions/azure-functions-core-tools@4',
            ]);
        });

        it('should fall back to npm, warning that it cannot be verified', async () => {
            setPlatform('linux');
            const { installer, spawn, output } = createInstaller(['npm']);

            await installer.install(installOptions());

            expect(installedWith(spawn)).to.deep.equal(['npm', 'install', '-g', 'azure-functions-core-tools']);
            expect(output.warn.mock.callCount()).to.equal(1);
        });

        it('should refuse npm when a signature is required', async () => {
            setPlatform('linux');
            const { installer, spawn } = createInstaller(['npm']);

            await expect(installer.install(installOptions({ requireSignature: true })))
                .to.be.rejectedWith(/No way to install/);
            expect(spawn.mock.callCount()).to.equal(0);
        });

        it('should satisfy a required signature through winget on Windows', async () => {
            setPlatform('win32');
            const { installer, spawn } = createInstaller(['winget', 'npm']);

            await installer.install(installOptions({ requireSignature: true }));

            expect(installedWith(spawn)[0]).to.equal('winget');
        });

        it('should throw when nothing on the system can install it', async () => {
            setPlatform('linux');
            const { installer } = createInstaller();

            await expect(installer.install(installOptions()))
                .to.be.rejectedWith(/No way to install/);
        });
    });
});
