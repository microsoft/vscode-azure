/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SwaInstaller } from '../../src/tools/SwaInstaller';
import { createInstallerHarness, installOptions, installedWith, usePlatform } from './installerTestHelpers';

function createInstaller(onPath: readonly string[] = [], versionOutput = '2.0.10') {
    return createInstallerHarness(SwaInstaller, onPath, { stdout: versionOutput, stderr: '' });
}

describe('SwaInstaller (unit)', () => {
    const setPlatform = usePlatform();

    describe('getVersion', () => {
        it('should read the plain version swa prints', async () => {
            const { installer } = createInstaller();

            expect(await installer.getVersion('/tools/swa')).to.equal('2.0.10');
        });

        it('should read the version from the last line when a notice precedes it', async () => {
            const { installer } = createInstaller([], 'Update available 2.0.9 -> 2.0.10\n2.0.10');

            expect(await installer.getVersion('/tools/swa')).to.equal('2.0.10');
        });

        it('should return undefined when swa cannot be run', async () => {
            const { installer, spawn } = createInstaller();
            spawn.mock.mockImplementation(() => Promise.reject(new Error('ENOENT')));

            expect(await installer.getVersion('/tools/swa')).to.be.undefined;
        });
    });

    describe('install', () => {
        it('should prefer brew on macOS, from core rather than a tap', async () => {
            setPlatform('darwin');
            const { installer, spawn } = createInstaller(['brew', 'npm']);

            await installer.install(installOptions());

            expect(installedWith(spawn)).to.deep.equal(['brew', 'install', 'static-web-apps-cli']);
        });

        it('should use npm on Windows, warning that it cannot be verified', async () => {
            setPlatform('win32');
            const { installer, spawn, output } = createInstaller(['npm', 'winget']);

            await installer.install(installOptions());

            // There is no winget or choco package, so npm is all there is --
            // even with winget present.
            expect(installedWith(spawn)).to.deep.equal(['npm', 'install', '-g', '@azure/static-web-apps-cli']);
            expect(output.warn.mock.callCount()).to.equal(1);
        });

        it('should refuse a required signature on Windows, where only npm exists', async () => {
            setPlatform('win32');
            const { installer, spawn } = createInstaller(['npm', 'winget']);

            await expect(installer.install(installOptions({ requireSignature: true })))
                .to.be.rejectedWith(/No way to install/);
            expect(spawn.mock.callCount()).to.equal(0);
        });

        it('should satisfy a required signature through brew on macOS', async () => {
            setPlatform('darwin');
            const { installer, spawn } = createInstaller(['brew', 'npm']);

            await installer.install(installOptions({ requireSignature: true }));

            expect(installedWith(spawn)[0]).to.equal('brew');
        });

        it('should throw when npm is not present', async () => {
            setPlatform('linux');
            const { installer } = createInstaller();

            await expect(installer.install(installOptions()))
                .to.be.rejectedWith(/No way to install/);
        });
    });
});
