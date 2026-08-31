/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProcessError, argToString, argsToStrings, type IProcessExecutor, type ProcessExecutorOptions } from '@microsoft/vscode-azure-utils';
import { MockUri, createMockVsCode, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { SwaCliConfigFileName, type SWACLIOptions } from '../../src/staticWebApps/SwaCliConfig';
import { MinSwaVersion, SwaCliService, SwaCommand } from '../../src/staticWebApps/SwaCliService';
import type { IToolService } from '../../src/tools/ToolService';

/**
 * A stand-in for {@linkcode IProcessExecutor.spawn} in tests. Intentionally
 * permissive (not the real overloaded `spawn` type) so each test can supply a
 * single-purpose fake without having to satisfy all four `spawn` overloads.
 */
type SpawnMethod = (...args: never[]) => unknown;

/**
 * A permissive projection of the real {@linkcode ProcessExecutorOptions} used to
 * read fields off a captured `spawn` call in assertions.
 */
type SpawnOpts = Omit<ProcessExecutorOptions, 'cwd'> & {
    readonly cwd: { path: string };
    readonly execution?: string;
};

function createService(spawnFn?: SpawnMethod, acquiredPath?: string) {
    const mockResult = createMockVsCode();
    const spawnMock = spawnFn ?? mock.fn(() => Promise.resolve({ stdout: '', stderr: '' }));
    const processExecutor = { spawn: spawnMock } as unknown as IProcessExecutor;
    const toolService: IToolService = {
        acquire: mock.fn(),
        getResolvedPath: mock.fn(() => acquiredPath),
    };
    const { executor } = createTestActionExecutor();
    const service = new SwaCliService(mockResult.vscode, processExecutor, executor, toolService);
    return { service, spawnMock: spawnMock as unknown as ReturnType<typeof mock.fn>, code: mockResult.vscode, fs: mockResult.fs, executor };
}

/** Seeds the config file that a real `swa init` would have written. */
function seedConfig(
    fs: ReturnType<typeof createMockVsCode>['fs'],
    code: ReturnType<typeof createMockVsCode>['vscode'],
    configurations: Record<string, SWACLIOptions>,
): void {
    fs.addFile(
        code.Uri.joinPath(code.Uri.file('/project'), SwaCliConfigFileName),
        JSON.stringify({ configurations }),
    );
}

describe('SwaCliService (unit)', () => {
    describe('init', () => {
        it('should spawn swa init with --yes and an explicit --config path', async () => {
            const { service, spawnMock, code, fs } = createService();
            seedConfig(fs, code, { project: { appLocation: 'src', outputLocation: 'dist' } });

            await service.init(MockUri.file('/project'));

            expect(spawnMock.mock.callCount()).to.equal(1);
            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(opts.execution).to.equal('background');
            expect(argToString(opts.command[0])).to.equal(SwaCommand);

            const args = argsToStrings(opts.command.slice(1));
            expect(args).to.include('init');
            expect(args).to.include('--yes');
            expect(args).to.include('--config');
            expect(opts.cwd.path).to.equal('/project');
        });

        it('should return the detected configuration', async () => {
            const { service, code, fs } = createService();
            const detected: SWACLIOptions = {
                appLocation: 'src',
                apiLocation: 'api',
                outputLocation: 'dist/my-app',
                appBuildCommand: 'npm run build',
            };
            seedConfig(fs, code, { project: detected });

            expect(await service.init(MockUri.file('/project'))).to.deep.equal(detected);
        });

        it('should pass a config name positionally and read that entry back', async () => {
            const { service, spawnMock, code, fs } = createService();
            seedConfig(fs, code, {
                first: { appLocation: 'other' },
                chosen: { appLocation: 'src' },
            });

            const result = await service.init(MockUri.file('/project'), 'chosen');

            expect(argsToStrings((spawnMock.mock.calls[0].arguments[0] as SpawnOpts).command.slice(1))).to.include('chosen');
            expect(result).to.deep.equal({ appLocation: 'src' });
        });

        it('should throw when the CLI exits zero without writing a configuration', async () => {
            const { service } = createService();

            await expect(service.init(MockUri.file('/project')))
                .to.be.rejectedWith(Error, SwaCliConfigFileName);
        });

        it('should use the absolute path returned by tool acquisition', async () => {
            const { service, spawnMock, code, fs } = createService(undefined, '/tools/swa');
            seedConfig(fs, code, { project: { appLocation: 'src' } });

            await service.init(MockUri.file('/project'));

            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(argToString(opts.command[0])).to.equal('/tools/swa');
        });
    });

    describe('checkVersion', () => {
        it('should return true when the CLI meets the minimum version', async () => {
            const spawnFn = mock.fn(() => Promise.resolve({ stdout: MinSwaVersion, stderr: '' }));
            const { service } = createService(spawnFn);

            expect(await service.checkVersion()).to.equal(true);
        });

        it('should return false when the CLI is older than the minimum version', async () => {
            const spawnFn = mock.fn(() => Promise.resolve({ stdout: '1.1.7', stderr: '' }));
            const { service } = createService(spawnFn);

            expect(await service.checkVersion()).to.equal(false);
        });

        it('should return undefined when no version can be read', async () => {
            const spawnFn = mock.fn(() => Promise.reject(new Error('not found')));
            const { service } = createService(spawnFn);

            expect(await service.checkVersion()).to.equal(undefined);
        });
    });

    describe('ENOENT handling', () => {
        it('should wrap ENOENT errors with an install hint and suppress display', async () => {
            const enoent = new ProcessError('The executable could not be found.', { code: 'ENOENT' });
            const spawnFn = mock.fn(() => Promise.reject(enoent));
            const { service, executor } = createService(spawnFn);

            let suppress: string | boolean | undefined;
            await expect(executor.callWithTelemetryAndErrorHandling('test', async (ctx) => {
                ctx.errorHandling.rethrow = true;
                try {
                    await service.init(MockUri.file('/project'));
                } finally {
                    suppress = ctx.errorHandling.suppress;
                }
            })).to.be.rejectedWith(Error, 'Azure Static Web Apps CLI (swa) was not found');

            expect(suppress).to.equal('display');
        });

        it('should report the minimum version when the CLI is present but too old', async () => {
            let call = 0;
            const spawnFn = mock.fn(() => {
                // The `init` spawn fails for some other reason; the version
                // probe that follows finds an unusable CLI.
                call += 1;
                return call === 1
                    ? Promise.reject(new Error('init failed'))
                    : Promise.resolve({ stdout: '1.1.7', stderr: '' });
            });
            const { service } = createService(spawnFn);

            await expect(service.init(MockUri.file('/project')))
                .to.be.rejectedWith(Error, MinSwaVersion);
        });
    });
});
