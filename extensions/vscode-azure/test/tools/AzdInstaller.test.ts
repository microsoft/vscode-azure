/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { argToString, argsToStrings, type IProcessExecutor } from '@microsoft/vscode-azure-utils';
import { MockOutputChannel, createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { AzdInstaller } from '../../src/tools/AzdInstaller';
import type { ToolInstallOptions } from '../../src/tools/ToolInstaller';

type SpawnOpts = { readonly command: unknown[], readonly execution?: string, readonly focus?: boolean };

function createInstaller(onPath: readonly string[] = []) {
    const spawn = mock.fn(() => Promise.resolve({ json: { azd: { version: '1.25.0' } } }));
    const processExecutor = {
        spawn,
        isOnPath: mock.fn((candidate: string) => onPath.includes(candidate)),
    } as unknown as IProcessExecutor;
    const output = new MockOutputChannel('test');

    return {
        installer: new AzdInstaller(createMockVsCode().vscode, processExecutor, output),
        spawn: spawn as unknown as ReturnType<typeof mock.fn>,
        output,
    };
}

function installOptions(overrides: Partial<ToolInstallOptions> = {}): ToolInstallOptions {
    return { requireSignature: false, reveal: false, ...overrides };
}

/** Returns the command line of the foreground install task. */
function installedWith(spawn: ReturnType<typeof mock.fn>): string[] {
    const opts = spawn.mock.calls[0].arguments[0] as SpawnOpts;
    expect(opts.execution).to.equal('foreground');
    return argsToStrings(opts.command as never);
}

describe('AzdInstaller (unit)', () => {
    const originalPlatform = process.platform;

    function setPlatform(value: string): void {
        Object.defineProperty(process, 'platform', { value, configurable: true });
    }

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

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
            const installer = new AzdInstaller(
                createMockVsCode().vscode,
                { spawn: mock.fn(() => Promise.reject(new Error('ENOENT'))) } as unknown as IProcessExecutor,
                new MockOutputChannel('test'),
            );

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

        it('should prefer winget on Windows', async () => {
            setPlatform('win32');
            const { installer, spawn } = createInstaller(['winget', 'choco']);

            await installer.install(installOptions());

            expect(installedWith(spawn)).to.deep.equal(['winget', 'install', 'microsoft.azd']);
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
            expect(output.warn.mock.callCount()).to.equal(0);
        });

        it('should verify the Windows install script is signed by Microsoft before running it', async () => {
            setPlatform('win32');
            const { installer, spawn } = createInstaller();

            await installer.install(installOptions());

            // The script path is only offered as a verified method because it
            // performs this check itself; losing it would silently downgrade
            // every `requireSignature` caller on a machine with no package manager.
            const script = installedWith(spawn).join(' ');
            expect(script).to.include('Get-AuthenticodeSignature');
            expect(script).to.include('O=Microsoft Corporation');
        });

        it('should satisfy a required signature on Windows with no package manager', async () => {
            setPlatform('win32');
            const { installer, spawn } = createInstaller();

            await installer.install(installOptions({ requireSignature: true }));

            expect(installedWith(spawn)[0]).to.equal('powershell');
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

        it('should reveal the install task when asked', async () => {
            setPlatform('linux');
            const { installer, spawn } = createInstaller();

            await installer.install(installOptions({ reveal: true }));

            expect((spawn.mock.calls[0].arguments[0] as SpawnOpts).focus).to.be.true;
        });
    });
});
