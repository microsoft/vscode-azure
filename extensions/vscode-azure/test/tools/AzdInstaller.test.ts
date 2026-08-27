/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { argToString, argsToStrings } from '@microsoft/vscode-azure-utils';
import { AzdInstaller } from '../../src/tools/AzdInstaller';
import { createInstallerHarness, installOptions, installedWith, usePlatform, type SpawnOpts } from './installerTestHelpers';

function createInstaller(onPath: readonly string[] = []) {
    return createInstallerHarness(AzdInstaller, onPath, { json: { azd: { version: '1.25.0' } } });
}

describe('AzdInstaller (unit)', () => {
    const setPlatform = usePlatform();

    describe('getVersion', () => {
        it('should read the version from azd JSON output', async () => {
            const { installer, spawn } = createInstaller();

            const version = await installer.getVersion('/tools/azd');

            expect(version).to.equal('1.25.0');
            const opts = spawn.mock.calls[0].arguments[0] as SpawnOpts;
            expect(argToString(opts.command[0] as never)).to.equal('/tools/azd');
            expect(argsToStrings(opts.command.slice(1) as never)).to.deep.equal(['version', '--output', 'json']);
        });

        it('should return undefined when azd cannot be run', async () => {
            const { installer, spawn } = createInstaller();
            spawn.mock.mockImplementation(() => Promise.reject(new Error('ENOENT')));

            expect(await installer.getVersion('/tools/azd')).to.be.undefined;
        });
    });

    describe('install', () => {
        it('should update an existing install that supports it', async () => {
            setPlatform('win32');
            const { installer, spawn } = createInstaller(['winget']);

            await installer.install(installOptions({
                current: { executablePath: '/tools/azd', version: '1.24.0' },
            }));

            expect(installedWith(spawn)).to.deep.equal(['/tools/azd', 'update']);
        });

        it('should prefer winget on Windows, accepting source agreements up front', async () => {
            setPlatform('win32');
            const { installer, spawn } = createInstaller(['winget', 'choco']);

            await installer.install(installOptions());

            expect(installedWith(spawn)).to.deep.equal([
                'winget', 'install', 'microsoft.azd', '--accept-source-agreements',
            ]);
        });

        it('should fall back to choco on Windows when winget is unavailable', async () => {
            setPlatform('win32');
            const { installer, spawn } = createInstaller(['choco']);

            await installer.install(installOptions());

            expect(installedWith(spawn)).to.deep.equal(['choco', 'upgrade', 'azd']);
        });

        it('should fall back to the install script on Windows with no package manager', async () => {
            setPlatform('win32');
            const { installer, spawn, output } = createInstaller();

            await installer.install(installOptions());

            expect(installedWith(spawn)[0]).to.equal('powershell');
            expect(output.warn.mock.callCount()).to.equal(1);
        });

        it('should prefer brew on macOS', async () => {
            setPlatform('darwin');
            const { installer, spawn } = createInstaller(['brew']);

            await installer.install(installOptions());

            expect(installedWith(spawn)).to.deep.equal(['brew', 'install', 'azure/azd/azd']);
        });

        it('should use the install script on Linux, warning that it cannot be verified', async () => {
            setPlatform('linux');
            const { installer, spawn, output } = createInstaller();

            await installer.install(installOptions());

            expect(installedWith(spawn)[0]).to.equal('bash');
            expect(output.warn.mock.callCount()).to.equal(1);
        });

        it('should refuse an unverified method when a signature is required', async () => {
            setPlatform('linux');
            const { installer, spawn } = createInstaller();

            await expect(installer.install(installOptions({ requireSignature: true })))
                .to.be.rejectedWith(/No way to install/);
            expect(spawn.mock.callCount()).to.equal(0);
        });

        it('should satisfy a required signature through winget on Windows', async () => {
            setPlatform('win32');
            const { installer, spawn } = createInstaller(['winget']);

            await installer.install(installOptions({ requireSignature: true }));

            expect(installedWith(spawn)[0]).to.equal('winget');
        });

        it('should refuse a required signature on Windows with no package manager', async () => {
            setPlatform('win32');
            const { installer, spawn } = createInstaller();

            // The install script is the only method left, and nothing about
            // piping it into PowerShell establishes where it came from.
            await expect(installer.install(installOptions({ requireSignature: true })))
                .to.be.rejectedWith(/No way to install/);
            expect(spawn.mock.callCount()).to.equal(0);
        });

        it('should reveal the install task when asked', async () => {
            setPlatform('linux');
            const { installer, spawn } = createInstaller();

            await installer.install(installOptions({ reveal: true }));

            expect((spawn.mock.calls[0].arguments[0] as SpawnOpts).focus).to.be.true;
        });
    });
});
