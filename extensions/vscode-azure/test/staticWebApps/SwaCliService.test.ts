/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProcessError, argToString, argsToStrings, type IProcessExecutor, type ProcessExecutorOptions } from '@microsoft/vscode-azure-utils';
import { MockUri, createMockVsCode, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type { ITempDirManager } from '../../src/azd/TempDirManager';
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

const ScratchDir = '/scratch';
const ProjectDir = '/project';

function createService(spawnFn?: SpawnMethod, acquiredPath?: string) {
    const mockResult = createMockVsCode();
    const spawnMock = spawnFn ?? mock.fn(() => Promise.resolve({ stdout: '', stderr: '' }));
    const processExecutor = { spawn: spawnMock } as unknown as IProcessExecutor;
    const toolService: IToolService = {
        acquire: mock.fn(),
        getResolvedPath: mock.fn(() => acquiredPath),
    };
    const createTempDir = mock.fn(() => Promise.resolve(mockResult.vscode.Uri.file(ScratchDir)));
    const tempDirs: ITempDirManager = {
        createTempDir,
        isTempDir: mock.fn(() => false),
    };
    const { executor } = createTestActionExecutor();
    const service = new SwaCliService(mockResult.vscode, processExecutor, executor, toolService, tempDirs);
    return { service, spawnMock: spawnMock as unknown as ReturnType<typeof mock.fn>, code: mockResult.vscode, fs: mockResult.fs, executor, createTempDir };
}

/** Seeds the configuration a real `swa init` would have written to `--config`. */
function seedDetected(
    fs: ReturnType<typeof createMockVsCode>['fs'],
    code: ReturnType<typeof createMockVsCode>['vscode'],
    detected: SWACLIOptions,
    configName = 'detected',
): void {
    fs.addFile(
        code.Uri.joinPath(code.Uri.file(ScratchDir), SwaCliConfigFileName),
        JSON.stringify({ configurations: { [configName]: detected } }),
    );
}

describe('SwaCliService (unit)', () => {
    describe('detect', () => {
        it('should scan the project but write its configuration outside it', async () => {
            const { service, spawnMock, code, fs } = createService();
            seedDetected(fs, code, { appLocation: 'src', outputLocation: 'dist' });

            await service.detect(MockUri.file(ProjectDir));

            expect(spawnMock.mock.callCount()).to.equal(1);
            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(opts.execution).to.equal('background');
            expect(argToString(opts.command[0])).to.equal(SwaCommand);

            const args = argsToStrings(opts.command.slice(1));
            expect(args).to.include('init');
            expect(args).to.include('--yes');

            // The scan follows cwd while the write follows --config, so the
            // project is only ever read.
            expect(opts.cwd.path).to.equal(ProjectDir);
            const configPath = args[args.indexOf('--config') + 1];
            expect(configPath).to.not.include(ProjectDir);
            expect(configPath).to.include(SwaCliConfigFileName);
        });

        it('should leave no configuration in the project folder', async () => {
            const { service, code, fs } = createService();
            seedDetected(fs, code, { appLocation: 'src' });

            await service.detect(MockUri.file(ProjectDir));

            const inProject = code.Uri.joinPath(code.Uri.file(ProjectDir), SwaCliConfigFileName);
            await expect(code.workspace.fs.readFile(inProject)).to.be.rejected;
        });

        it('should return the detected configuration', async () => {
            const { service, code, fs } = createService();
            const detected: SWACLIOptions = {
                appLocation: 'src',
                apiLocation: 'api',
                outputLocation: 'dist/my-app',
                appBuildCommand: 'npm run build',
            };
            seedDetected(fs, code, detected);

            const result = await service.detect(MockUri.file(ProjectDir));
            expect(result.options).to.deep.equal(detected);
            expect(result.config).to.deep.equal({ configurations: { detected } });
        });

        it('should read back the entry it named rather than the first one', async () => {
            const { service, spawnMock, code, fs } = createService();
            fs.addFile(
                code.Uri.joinPath(code.Uri.file(ScratchDir), SwaCliConfigFileName),
                JSON.stringify({ configurations: { other: { appLocation: 'wrong' }, detected: { appLocation: 'src' } } }),
            );

            const result = await service.detect(MockUri.file(ProjectDir));

            expect(argsToStrings((spawnMock.mock.calls[0].arguments[0] as SpawnOpts).command.slice(1))).to.include('detected');
            expect(result.options).to.deep.equal({ appLocation: 'src' });
        });

        it('should throw when the CLI exits zero without detecting anything', async () => {
            const { service } = createService();

            await expect(service.detect(MockUri.file(ProjectDir)))
                .to.be.rejectedWith(Error, 'could not detect');
        });

        it('should use the absolute path returned by tool acquisition', async () => {
            const { service, spawnMock, code, fs } = createService(undefined, '/tools/swa');
            seedDetected(fs, code, { appLocation: 'src' });

            await service.detect(MockUri.file(ProjectDir));

            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(argToString(opts.command[0])).to.equal('/tools/swa');
        });
    });

    describe('workspace trust', () => {
        it('should refuse to detect in an untrusted workspace before creating or spawning anything', async () => {
            const { service, spawnMock, code, createTempDir } = createService();
            mock.property(code.workspace, 'isTrusted', false);

            await expect(service.detect(MockUri.file(ProjectDir)))
                .to.be.rejectedWith(/untrusted workspace/);

            expect(createTempDir.mock.callCount()).to.equal(0);
            expect(spawnMock.mock.callCount()).to.equal(0);
        });

        it('should detect in a scratch directory even when the workspace is untrusted', async () => {
            const { service, spawnMock, code, fs } = createService();
            mock.property(code.workspace, 'isTrusted', false);
            seedDetected(fs, code, { appLocation: 'src' });

            const result = await service.detect(MockUri.file(ProjectDir), { scratch: true });

            expect(spawnMock.mock.callCount()).to.equal(1);
            expect(result.options).to.deep.equal({ appLocation: 'src' });
        });

        it('should still read the CLI version when the workspace is untrusted', async () => {
            const spawnFn = mock.fn(() => Promise.resolve({ stdout: MinSwaVersion, stderr: '' }));
            const { service, code } = createService(spawnFn);
            mock.property(code.workspace, 'isTrusted', false);

            expect(await service.checkVersion()).to.equal(true);
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
                    await service.detect(MockUri.file(ProjectDir));
                } finally {
                    suppress = ctx.errorHandling.suppress;
                }
            })).to.be.rejectedWith(Error, 'Azure Static Web Apps CLI (swa) was not found');

            expect(suppress).to.equal('display');
        });

        it('should report the minimum version when the CLI is present but too old', async () => {
            let call = 0;
            const spawnFn = mock.fn(() => {
                // The detection spawn fails for some other reason; the version
                // probe that follows finds an unusable CLI.
                call += 1;
                return call === 1
                    ? Promise.reject(new Error('detect failed'))
                    : Promise.resolve({ stdout: '1.1.7', stderr: '' });
            });
            const { service } = createService(spawnFn);

            await expect(service.detect(MockUri.file(ProjectDir)))
                .to.be.rejectedWith(Error, MinSwaVersion);
        });
    });
});
