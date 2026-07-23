/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IProcessExecutor } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, MockOutputChannel } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import {
    MinimumSwaCliVersion,
    SwaCliPackageName,
    SwaCliService,
    type SwaCliFetch,
} from '../../src/staticWebApps/SwaCliService';

describe('SwaCliService (unit)', () => {
    it('should check npm and clean the globally installed version', async () => {
        const spawn = mock.fn((options: { command: readonly string[] }) => {
            return Promise.resolve({
                stdout: options.command[0] === 'npx' ? 'v0.8.0\n' : '10.0.0\n',
                stderr: '',
            });
        });
        const service = createService(spawn);

        expect(await service.hasNpm()).to.equal(true);
        expect(await service.getInstalledVersion()).to.equal(MinimumSwaCliVersion);
        expect(spawn.mock.calls[0].arguments[0].command).to.deep.equal(['npm', '--version']);
        expect(spawn.mock.calls[1].arguments[0].command).to.deep.equal([
            'npx', '--global', '--no-install', 'swa', '--version',
        ]);
    });

    it('should return unavailable states when process checks fail', async () => {
        const spawn = mock.fn(() => Promise.reject(new Error('not found')));
        const service = createService(spawn);

        expect(await service.hasNpm()).to.equal(false);
        expect(await service.getInstalledVersion()).to.equal(undefined);
    });

    it('should install and uninstall with exact npm commands', async () => {
        const spawn = mock.fn((options: { command: readonly string[]; execution: string }) => {
            if (options.command[0] === 'npx') {
                return Promise.resolve({ stdout: '1.0.0', stderr: '' });
            }
            return options.execution === 'background'
                ? Promise.resolve({ stdout: '10.0.0', stderr: '' })
                : Promise.resolve();
        });
        const service = createService(spawn);

        await service.installOrUpdate();
        await service.uninstall();

        const commands = spawn.mock.calls.map(call => call.arguments[0].command);
        expect(commands).to.deep.include([
            'npm', 'install', '--global', `${SwaCliPackageName}@latest`,
        ]);
        expect(commands).to.deep.include([
            'npm', 'uninstall', '--global', SwaCliPackageName,
        ]);
    });

    it('should read dist-tags.latest without logging registry response bodies', async () => {
        const fetcher = mock.fn((_url: string, _init: { readonly signal: AbortSignal }) => Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ 'dist-tags': { latest: '2.0.2' } }),
        }));
        const service = createService(
            mock.fn(() => Promise.resolve({ stdout: '', stderr: '' })),
            fetcher,
        );

        expect(await service.getNewestVersion()).to.equal('2.0.2');
        expect(fetcher.mock.calls[0].arguments[0]).to.equal(
            `https://registry.npmjs.org/${SwaCliPackageName}`,
        );
        expect(fetcher.mock.calls[0].arguments[1].signal).to.be.instanceOf(AbortSignal);
    });

    it('should reject malformed registry metadata with a useful error', async () => {
        const fetcher = mock.fn((_url: string, _init: { readonly signal: AbortSignal }) => Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({}),
        }));
        const service = createService(
            mock.fn(() => Promise.resolve({ stdout: '', stderr: '' })),
            fetcher,
        );

        let error: unknown;
        try {
            await service.getNewestVersion();
        } catch (caught) {
            error = caught;
        }
        expect((error as Error).message).to.equal(
            'Failed to retrieve the latest version of the Azure Static Web Apps CLI.',
        );
    });

    it('should validate an installed minimum version without prompting', async () => {
        const { mockResult, service } = createServiceResult(mock.fn(() =>
            Promise.resolve({ stdout: '0.8.1', stderr: '' })));

        expect(await service.validateInstalled('CLI required')).to.equal(true);
        expect(mockResult.window.showWarningMessage.mock.callCount()).to.equal(0);
    });
});

function createService(
    spawn: ReturnType<typeof mock.fn>,
    fetcher?: SwaCliFetch,
): SwaCliService {
    return createServiceResult(spawn, fetcher).service;
}

function createServiceResult(
    spawn: ReturnType<typeof mock.fn>,
    fetcher?: SwaCliFetch,
): { readonly mockResult: ReturnType<typeof createMockVsCode>; readonly service: SwaCliService } {
    const mockResult = createMockVsCode();
    const processExecutor = {
        spawn,
        isOnPath: mock.fn(() => Promise.resolve(true)),
    } as unknown as IProcessExecutor;
    return {
        mockResult,
        service: new SwaCliService(
            mockResult.vscode,
            processExecutor,
            new MockOutputChannel('test'),
            fetcher,
        ),
    };
}
