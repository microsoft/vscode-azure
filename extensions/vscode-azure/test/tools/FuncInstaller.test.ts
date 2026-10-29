/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FuncInstaller } from '../../src/tools/FuncInstaller';
import { describeLongRunning } from '@microsoft/vscode-azure-utils/testing';
import { createInstallerHarness, installOptions, installedWith, usePlatform } from './installerTestHelpers';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { mock } from 'node:test';
import { promisify } from 'node:util';

function createInstaller(onPath: readonly string[] = [], versionOutput = '5.0.0-preview.1') {
    return createInstallerHarness(FuncInstaller, onPath, { stdout: versionOutput, stderr: '' });
}

function windowsScript(spawn: Parameters<typeof installedWith>[0]): string {
    const line = installedWith(spawn);
    const index = line.indexOf('-Command');
    if (index < 0 || !line[index + 1]) {
        throw new Error('Expected a PowerShell bootstrap command.');
    }
    return line[index + 1];
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
        describeLongRunning('FuncInstaller PowerShell bootstrap (integration)', () => {
            const exec = promisify(execFile);
            // Not run in the default pipelines. Anyone changing the install script should run this on Windows
            // (ENABLE_LONG_RUNNING_TESTS=1) and still verify the real installation by hand.
            it('binds the installer switches through Windows PowerShell when upgrading', async function () {
                if (process.platform !== 'win32') {
                    this.skip();
                }
                const { installer, spawn } = createInstaller();
                await installer.install(installOptions({ current: { executablePath: '/tools/func', version: '4.6.0' } }));
                const requested = mock.fn<(url: string | undefined) => void>();
                const server = createServer((request, response) => {
                    requested(request.url);
                    response.setHeader('Content-Type', 'text/plain');
                    response.end('param([switch]$Prerelease, [switch]$Force)\n@{ prerelease = $Prerelease.IsPresent; force = $Force.IsPresent } | ConvertTo-Json -Compress');
                });
                await new Promise<void>((resolve, reject) => {
                    server.once('error', reject);
                    server.listen(0, '127.0.0.1', resolve);
                });
                try {
                    const address = server.address();
                    if (!address || typeof address === 'string') {
                        throw new Error('Expected a loopback installer endpoint.');
                    }
                    const script = windowsScript(spawn);
                    expect(script.match(/https?:\/\/[^\s)]+/g)).to.deep.equal(['https://aka.ms/func-cli/install.ps1']);
                    const args = installedWith(spawn).slice(1);
                    expect(args).to.not.include('-ExecutionPolicy');
                    args[args.indexOf('-Command') + 1] = script.replace(
                        'https://aka.ms/func-cli/install.ps1',
                        `http://127.0.0.1:${address.port}/install.ps1`,
                    );
                    const shell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
                    // VS Code surrounds strongly quoted task arguments without escaping their contents.
                    const line = `& '${shell}' ${args.map(value => `'${value}'`).join(' ')}`;
                    // AllSigned rejects any unsigned script file, so this proves no policy override is needed.
                    const { stdout } = await exec(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'AllSigned', '-Command', line], {
                        timeout: 8_000,
                        windowsHide: true,
                    });
                    const flags: unknown = JSON.parse(stdout);
                    expect(flags).to.deep.equal({ prerelease: true, force: true });
                    expect(requested.mock.calls.map(call => call.arguments[0])).to.deep.equal(['/install.ps1']);
                } finally {
                    server.closeAllConnections();
                    await new Promise<void>((resolve, reject) => {
                        server.close(error => {
                            if (error) {
                                reject(error);
                            } else {
                                resolve();
                            }
                        });
                    });
                }
            });
        }, { timeoutMs: 10_000 });

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
