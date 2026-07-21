/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IProcessExecutor, type CommandLineArg, argToString, argsToStrings } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, createTestActionExecutor, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import type { IAzdAuthServer } from '../../src/azd/AzdAuthServer';
import { AzdCommand, AzdService, MinAzdUpdateVersion, MinAzdVersion } from '../../src/azd/AzdService';

/**
 * A stand-in for {@linkcode IProcessExecutor.spawn} in tests. Typed permissively
 * because each test supplies a single-purpose fake rather than the full
 * overloaded implementation; the value is cast to {@linkcode IProcessExecutor}
 * when constructing the service.
 */
type SpawnMethod = (...args: never[]) => unknown;

interface SpawnOpts {
    execution: string;
    command: readonly CommandLineArg[];
    cwd: { path: string };
    parseJson?: boolean;
    name?: string;
    source?: string;
    env?: Record<string, string>;
}

function createService(spawnFn?: SpawnMethod, isOnPathFn?: (cmd: string) => Promise<boolean>) {
    const mockResult = createMockVsCode();
    const spawnMock = spawnFn ?? mock.fn(() => Promise.resolve({ stdout: '', stderr: '' }));
    const isOnPathMock = isOnPathFn ?? mock.fn(() => Promise.resolve(false));
    const processExecutor = { spawn: spawnMock, isOnPath: isOnPathMock } as unknown as IProcessExecutor;
    const authServer: IAzdAuthServer = { getEnv: mock.fn(() => Promise.resolve({})) };
    const { executor } = createTestActionExecutor();
    const service = new AzdService(mockResult.vscode, processExecutor, executor, authServer);
    return { service, spawnMock: spawnMock as unknown as ReturnType<typeof mock.fn>, fs: mockResult.fs, executor };
}

describe('AzdService (unit)', () => {
    describe('findAzureYaml', () => {
        it('should return azure.yaml URI when it exists', async () => {
            const { service, fs } = createService();
            fs.addFile(MockUri.file('/project/azure.yaml'));

            const result = await service.findAzureYaml(MockUri.file('/project'));

            expect(result).to.have.length(1);
            expect(result[0].path).to.equal('/project/azure.yaml');
        });

        it('should return azure.yml URI when azure.yaml does not exist', async () => {
            const { service, fs } = createService();
            fs.addFile(MockUri.file('/project/azure.yml'));

            const result = await service.findAzureYaml(MockUri.file('/project'));

            expect(result).to.have.length(1);
            expect(result[0].path).to.equal('/project/azure.yml');
        });

        it('should prefer azure.yaml over azure.yml when both exist', async () => {
            const { service, fs } = createService();
            fs.addFile(MockUri.file('/project/azure.yaml'));
            fs.addFile(MockUri.file('/project/azure.yml'));

            const result = await service.findAzureYaml(MockUri.file('/project'));

            expect(result[0].path).to.equal('/project/azure.yaml');
        });

        it('should return empty array when neither file exists', async () => {
            const { service } = createService();

            const result = await service.findAzureYaml(MockUri.file('/project'));

            expect(result).to.deep.equal([]);
        });
    });

    describe('init', () => {
        it('should spawn azd init with --minimal and --no-prompt', async () => {
            const { service, spawnMock } = createService();

            await service.init(MockUri.file('/project'));

            expect(spawnMock.mock.callCount()).to.equal(1);
            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(opts.execution).to.equal('background');
            expect(argToString(opts.command[0])).to.equal(AzdCommand);
            expect(argsToStrings(opts.command.slice(1))).to.include('init');
            expect(argsToStrings(opts.command.slice(1))).to.include('--minimal');
            expect(argsToStrings(opts.command.slice(1))).to.include('--no-prompt');
            expect(opts.cwd.path).to.equal('/project');
        });
    });

    describe('envNew', () => {
        it('should spawn azd env new with name, location, and subscription', async () => {
            const { service, spawnMock } = createService();

            await service.envNew('dev', 'eastus', 'sub-1', MockUri.file('/project'));

            expect(spawnMock.mock.callCount()).to.equal(1);
            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(opts.execution).to.equal('background');
            expect(argToString(opts.command[0])).to.equal(AzdCommand);
            expect(argsToStrings(opts.command.slice(1))).to.include('env');
            expect(argsToStrings(opts.command.slice(1))).to.include('new');
            expect(argsToStrings(opts.command.slice(1))).to.include('dev');
            expect(argsToStrings(opts.command.slice(1))).to.include('--location');
            expect(argsToStrings(opts.command.slice(1))).to.include('eastus');
            expect(argsToStrings(opts.command.slice(1))).to.include('--subscription');
            expect(argsToStrings(opts.command.slice(1))).to.include('sub-1');
            expect(opts.cwd.path).to.equal('/project');
        });
    });

    describe('envExists', () => {
        it('should return true when an environment with the given name is in envList', async () => {
            const envs = [{ Name: 'dev', IsDefault: true }, { Name: 'prod', IsDefault: false }];
            const spawnFn = mock.fn(() => Promise.resolve({ json: envs }));
            const { service } = createService(spawnFn);

            const result = await service.envExists('prod', MockUri.file('/project'));

            expect(result).to.be.true;
        });

        it('should return false when no environment with the given name exists', async () => {
            const envs = [{ Name: 'dev', IsDefault: true }];
            const spawnFn = mock.fn(() => Promise.resolve({ json: envs }));
            const { service } = createService(spawnFn);

            const result = await service.envExists('missing', MockUri.file('/project'));

            expect(result).to.be.false;
        });

        it('should return false when envList rejects (azd not installed)', async () => {
            const enoent = Object.assign(new Error('spawn azd ENOENT'), { code: 'ENOENT' });
            const spawnFn = mock.fn(() => Promise.reject(enoent));
            const { service } = createService(spawnFn);

            const result = await service.envExists('dev', MockUri.file('/project'));

            expect(result).to.be.false;
        });
    });

    describe('envList', () => {
        it('should spawn azd env list with --output json and return parsed result', async () => {
            const envs = [{ Name: 'dev', IsDefault: true }];
            const spawnFn = mock.fn(() => Promise.resolve({ json: envs }));
            const { service, spawnMock } = createService(spawnFn);

            const result = await service.envList(MockUri.file('/project'));

            expect(result).to.deep.equal(envs);
            expect(spawnMock.mock.callCount()).to.equal(1);
            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(opts.execution).to.equal('background');
            expect(argsToStrings(opts.command.slice(1))).to.include('env');
            expect(argsToStrings(opts.command.slice(1))).to.include('list');
            expect(argsToStrings(opts.command.slice(1))).to.include('--output');
            expect(argsToStrings(opts.command.slice(1))).to.include('json');
            expect(opts.parseJson).to.be.true;
        });
    });

    describe('envGetValues', () => {
        it('should spawn azd env get-values with --environment <name> --output json and return parsed result', async () => {
            const values = {
                /* eslint-disable @typescript-eslint/naming-convention -- azd env keys */
                AZURE_ENV_NAME: 'dev',
                AZURE_LOCATION: 'eastus',
                AZURE_SUBSCRIPTION_ID: 'sub-1',
                /* eslint-enable @typescript-eslint/naming-convention */
            };
            const spawnFn = mock.fn(() => Promise.resolve({ json: values }));
            const { service, spawnMock } = createService(spawnFn);

            const result = await service.envGetValues('dev', MockUri.file('/project'));

            expect(result).to.deep.equal(values);
            expect(spawnMock.mock.callCount()).to.equal(1);
            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(opts.execution).to.equal('background');
            expect(argToString(opts.command[0])).to.equal(AzdCommand);
            expect(argsToStrings(opts.command.slice(1))).to.include('env');
            expect(argsToStrings(opts.command.slice(1))).to.include('get-values');
            expect(argsToStrings(opts.command.slice(1))).to.include('--environment');
            expect(argsToStrings(opts.command.slice(1))).to.include('dev');
            expect(argsToStrings(opts.command.slice(1))).to.include('--output');
            expect(argsToStrings(opts.command.slice(1))).to.include('json');
            expect(opts.parseJson).to.be.true;
            expect(opts.cwd.path).to.equal('/project');
        });

        it('should return an empty object when the spawn fails (best-effort)', async () => {
            const spawnFn = mock.fn(() => Promise.reject(new Error('env not found')));
            const { service } = createService(spawnFn);

            const result = await service.envGetValues('dev', MockUri.file('/project'));

            expect(result).to.deep.equal({});
        });
    });

    describe('show', () => {
        it('should spawn azd show with --output json and return parsed result', async () => {
            const payload = {
                name: 'my-app',
                services: { myfunc: { ingressUrl: 'https://myapp.azurewebsites.net' } },
            };
            const spawnFn = mock.fn(() => Promise.resolve({ json: payload }));
            const { service, spawnMock } = createService(spawnFn);

            const result = await service.show(MockUri.file('/project'));

            expect(result).to.deep.equal(payload);
            expect(spawnMock.mock.callCount()).to.equal(1);
            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(opts.execution).to.equal('background');
            expect(argToString(opts.command[0])).to.equal(AzdCommand);
            expect(argsToStrings(opts.command.slice(1))).to.include('show');
            expect(argsToStrings(opts.command.slice(1))).to.include('--output');
            expect(argsToStrings(opts.command.slice(1))).to.include('json');
            expect(opts.parseJson).to.be.true;
        });

        it('should return undefined when the spawn fails', async () => {
            const spawnFn = mock.fn(() => Promise.reject(new Error('no azure.yaml')));
            const { service } = createService(spawnFn);

            const result = await service.show(MockUri.file('/project'));

            expect(result).to.be.undefined;
        });
    });

    describe('ENOENT handling', () => {
        it('should wrap ENOENT errors with an install hint and suppress display', async () => {
            const enoent = Object.assign(new Error('spawn azd ENOENT'), { code: 'ENOENT' });
            const spawnFn = mock.fn(() => Promise.reject(enoent));
            const { service, executor } = createService(spawnFn);

            let suppress: string | boolean | undefined;
            try {
                await executor.callWithTelemetryAndErrorHandling('test', async (ctx) => {
                    ctx.errorHandling.rethrow = true;
                    try {
                        await service.init(MockUri.file('/project'));
                    } finally {
                        suppress = ctx.errorHandling.suppress;
                    }
                });
                expect.fail('Expected error');
            } catch (e) {
                expect((e as Error).message).to.include('Azure Developer CLI (azd) was not found');
                expect((e as Error).cause).to.equal(enoent);
                expect(suppress).to.equal('display');
            }
        });

        it('should report outdated version and suppress display when azd is too old', async () => {
            let callCount = 0;
            const spawnFn = mock.fn(() => {
                callCount++;
                if (callCount === 1) {
                    // First call: the azd command that fails
                    return Promise.reject(new Error('something went wrong'));
                }
                // Second call: checkVersion
                return Promise.resolve({ json: { azd: { version: '1.0.0', commit: 'abc' } } });
            });
            const { service, executor } = createService(spawnFn);

            let suppress: string | boolean | undefined;
            try {
                await executor.callWithTelemetryAndErrorHandling('test', async (ctx) => {
                    ctx.errorHandling.rethrow = true;
                    try {
                        await service.init(MockUri.file('/project'));
                    } finally {
                        suppress = ctx.errorHandling.suppress;
                    }
                });
                expect.fail('Expected error');
            } catch (e) {
                expect((e as Error).message).to.include('version');
                expect((e as Error).message).to.include(MinAzdVersion);
                expect(suppress).to.equal('display');
            }
        });

        it('should rethrow non-ENOENT errors as-is when version is sufficient', async () => {
            let callCount = 0;
            const other = new Error('something else');
            const spawnFn = mock.fn(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.reject(other);
                }
                // checkVersion call
                return Promise.resolve({ json: { azd: { version: MinAzdVersion, commit: 'abc' } } });
            });
            const { service } = createService(spawnFn);

            try {
                await service.init(MockUri.file('/project'));
                expect.fail('Expected error');
            } catch (e) {
                expect(e).to.equal(other);
            }
        });
    });

    describe('provision', () => {
        it('should spawn foreground execution with provision args', async () => {
            const spawnFn = mock.fn(() => Promise.resolve());
            const { service, spawnMock, fs } = createService(spawnFn);
            fs.addFile(MockUri.file('/project/azure.yaml'));

            await service.provision(MockUri.file('/project'));

            expect(spawnMock.mock.callCount()).to.equal(1);
            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(opts.execution).to.equal('foreground');
            expect(argToString(opts.command[0])).to.equal(AzdCommand);
            expect(argsToStrings(opts.command.slice(1))).to.include('provision');
            expect(opts.source).to.equal('azd');
        });

        it('should merge extra env vars into the task environment', async () => {
            const spawnFn = mock.fn(() => Promise.resolve());
            const { service, spawnMock, fs } = createService(spawnFn);
            fs.addFile(MockUri.file('/project/azure.yaml'));

            await service.provision(MockUri.file('/project'), {
                AZD_DEPLOYMENT_ID_FILE: '/tmp/deploy-id.json', // eslint-disable-line @typescript-eslint/naming-convention
            });

            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(opts.env).to.have.property('AZD_DEPLOYMENT_ID_FILE', '/tmp/deploy-id.json');
        });

        it('should reject on non-zero exit code', async () => {
            const spawnFn = mock.fn(() => Promise.reject(new Error('Process exited with code 1')));
            const { service, fs } = createService(spawnFn);
            fs.addFile(MockUri.file('/project/azure.yaml'));

            try {
                await service.provision(MockUri.file('/project'));
                expect.fail('Expected error');
            } catch (e) {
                expect((e as Error).message).to.include('Process exited with code 1');
            }
        });
    });

    describe('deploy', () => {
        it('should spawn foreground execution for deploy', async () => {
            const spawnFn = mock.fn(() => Promise.resolve());
            const { service, spawnMock, fs } = createService(spawnFn);
            fs.addFile(MockUri.file('/project/azure.yaml'));

            await service.deploy(MockUri.file('/project'));

            expect(spawnMock.mock.callCount()).to.equal(1);
            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(opts.execution).to.equal('foreground');
            expect(argToString(opts.command[0])).to.equal(AzdCommand);
            expect(argsToStrings(opts.command.slice(1))).to.include('deploy');
            expect(opts.source).to.equal('azd');
        });

        it('should reject on non-zero exit code', async () => {
            const spawnFn = mock.fn(() => Promise.reject(new Error('Process exited with code 2')));
            const { service, fs } = createService(spawnFn);
            fs.addFile(MockUri.file('/project/azure.yaml'));

            try {
                await service.deploy(MockUri.file('/project'));
                expect.fail('Expected error');
            } catch (e) {
                expect((e as Error).message).to.include('Process exited with code 2');
            }
        });
    });

    describe('down', () => {
        it('should spawn foreground execution with down --force --purge', async () => {
            const spawnFn = mock.fn(() => Promise.resolve());
            const { service, spawnMock } = createService(spawnFn);

            await service.down(MockUri.file('/project'));

            expect(spawnMock.mock.callCount()).to.equal(1);
            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(opts.execution).to.equal('foreground');
            expect(argToString(opts.command[0])).to.equal(AzdCommand);
            expect(argsToStrings(opts.command.slice(1))).to.include('down');
            expect(argsToStrings(opts.command.slice(1))).to.include('--force');
            expect(argsToStrings(opts.command.slice(1))).to.include('--purge');
            expect(opts.cwd.path).to.equal('/project');
            expect(opts.source).to.equal('azd');
        });

        it('should pass the auth environment to the task', async () => {
            const spawnFn = mock.fn((_opts: unknown) => Promise.resolve());
            const mockResult = createMockVsCode();
            const processExecutor = {
                spawn: spawnFn,
                isOnPath: mock.fn(() => Promise.resolve(false)),
            } as unknown as IProcessExecutor;
            const authServer: IAzdAuthServer = { getEnv: mock.fn(() => Promise.resolve({ AZD_AUTH: 'token' })) }; // eslint-disable-line @typescript-eslint/naming-convention
            const { executor } = createTestActionExecutor();
            const service = new AzdService(mockResult.vscode, processExecutor, executor, authServer);

            await service.down(MockUri.file('/project'));

            const opts = spawnFn.mock.calls[0].arguments[0] as SpawnOpts;
            expect(opts.env).to.have.property('AZD_AUTH', 'token');
        });

        it('should reject on non-zero exit code', async () => {
            const spawnFn = mock.fn(() => Promise.reject(new Error('Process exited with code 3')));
            const { service } = createService(spawnFn);

            try {
                await service.down(MockUri.file('/project'));
                expect.fail('Expected error');
            } catch (e) {
                expect((e as Error).message).to.include('Process exited with code 3');
            }
        });
    });

    describe('checkVersion', () => {
        function makeVersionSpawn(version: string): SpawnMethod {
            return mock.fn(() => Promise.resolve({ json: { azd: { version, commit: 'abc' } } }));
        }

        it('should return true when the installed version meets the minimum', async () => {
            const { service } = createService(makeVersionSpawn('1.9.5'));

            const result = await service.checkVersion('1.9.0');

            expect(result).to.be.true;
        });

        it('should return true when the installed version equals the minimum', async () => {
            const { service } = createService(makeVersionSpawn('1.9.0'));

            const result = await service.checkVersion('1.9.0');

            expect(result).to.be.true;
        });

        it('should return false when the installed version is below the minimum', async () => {
            const { service } = createService(makeVersionSpawn('1.8.0'));

            const result = await service.checkVersion('1.9.0');

            expect(result).to.be.false;
        });

        it('should return undefined when azd is not installed (ENOENT)', async () => {
            const enoent = Object.assign(new Error('spawn azd ENOENT'), { code: 'ENOENT' });
            const spawnFn = mock.fn(() => Promise.reject(enoent));
            const { service } = createService(spawnFn);

            const result = await service.checkVersion('1.0.0');

            expect(result).to.be.undefined;
        });

        it('should handle prerelease versions', async () => {
            const { service } = createService(makeVersionSpawn('1.25.0-beta.1-pr.6266592'));

            const result = await service.checkVersion('1.9.0');

            expect(result).to.be.true;
        });

        it('should default to MinAzdVersion when no argument is provided', async () => {
            const { service } = createService(makeVersionSpawn(MinAzdVersion));

            const result = await service.checkVersion();

            expect(result).to.be.true;
        });

        it('should return undefined for an invalid version string', async () => {
            const { service } = createService(makeVersionSpawn('not-a-version'));

            const result = await service.checkVersion('1.0.0');

            expect(result).to.be.undefined;
        });

        it('should cache the version and not spawn again on subsequent calls', async () => {
            const spawnFn = makeVersionSpawn('1.9.5');
            const { service, spawnMock } = createService(spawnFn);

            await service.checkVersion('1.9.0');
            await service.checkVersion('1.8.0');

            expect(spawnMock.mock.callCount()).to.equal(1);
        });

        it('should clear the cache after install is called', async () => {
            let callCount = 0;
            const spawnFn = mock.fn(() => {
                callCount++;
                if (callCount === 1) {
                    // First call: checkVersion
                    return Promise.resolve({ json: { azd: { version: '1.8.0', commit: 'abc' } } });
                }
                // Second call: install (foreground)
                // Third call: checkVersion again
                if (callCount === 3) {
                    return Promise.resolve({ json: { azd: { version: '1.9.5', commit: 'def' } } });
                }
                return Promise.resolve();
            });
            const { service } = createService(spawnFn);

            const before = await service.checkVersion('1.9.0');
            expect(before).to.be.false;

            await service.install();

            const after = await service.checkVersion('1.9.0');
            expect(after).to.be.true;
        });
    });

    describe('install', () => {
        it('should spawn a foreground task with platform install when azd is not installed', async () => {
            // checkVersion will fail (ENOENT), so install falls back to platform command
            const spawnFn = mock.fn(() => Promise.resolve());
            const { service, spawnMock } = createService(spawnFn);

            await service.install();

            // 1st call = checkVersion (azd version), 2nd call = foreground install
            expect(spawnMock.mock.callCount()).to.equal(2);
            const opts = spawnMock.mock.calls[1].arguments[0] as SpawnOpts;
            expect(opts.execution).to.equal('foreground');
            expect(opts.source).to.equal('azd');
        });

        it('should use azd update when version supports it', async () => {
            const spawnFn = mock.fn((opts: SpawnOpts) => {
                if (argToString(opts.command[0]) === AzdCommand && argsToStrings(opts.command.slice(1)).includes('version')) {
                    return Promise.resolve({ json: { azd: { version: MinAzdUpdateVersion } } });
                }
                return Promise.resolve();
            });
            const { service, spawnMock } = createService(spawnFn);

            await service.install();

            expect(spawnMock.mock.callCount()).to.equal(2);
            const opts = spawnMock.mock.calls[1].arguments[0] as SpawnOpts;
            expect(opts.execution).to.equal('foreground');
            expect(argToString(opts.command[0])).to.equal('azd');
            expect(argsToStrings(opts.command.slice(1))).to.deep.equal(['update']);
        });

        describe('platform fallback commands', () => {
            // All platform tests use a version too old for `azd update`
            // so the fallback logic is exercised.
            function makeOldVersionSpawn(): SpawnMethod {
                return mock.fn((opts: SpawnOpts) => {
                    if (argToString(opts.command[0]) === AzdCommand && argsToStrings(opts.command.slice(1)).includes('version')) {
                        return Promise.resolve({ json: { azd: { version: '1.0.0' } } });
                    }
                    return Promise.resolve();
                });
            }

            const originalPlatform = process.platform;
            function setPlatform(value: string): void {
                Object.defineProperty(process, 'platform', { value, configurable: true });
            }

            afterEach(() => {
                Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
            });

            it('should use winget on Windows when winget is available', async () => {
                setPlatform('win32');
                const isOnPathFn = mock.fn((cmd: string) => Promise.resolve(cmd === 'winget'));
                const { service, spawnMock } = createService(makeOldVersionSpawn(), isOnPathFn);

                await service.install();

                const opts = spawnMock.mock.calls[1].arguments[0] as SpawnOpts;
                expect(argToString(opts.command[0])).to.equal('winget');
                expect(argsToStrings(opts.command.slice(1))).to.deep.equal(['install', 'microsoft.azd']);
            });

            it('should use choco on Windows when winget is unavailable', async () => {
                setPlatform('win32');
                const isOnPathFn = mock.fn((cmd: string) => Promise.resolve(cmd === 'choco'));
                const { service, spawnMock } = createService(makeOldVersionSpawn(), isOnPathFn);

                await service.install();

                const opts = spawnMock.mock.calls[1].arguments[0] as SpawnOpts;
                expect(argToString(opts.command[0])).to.equal('choco');
                expect(argsToStrings(opts.command.slice(1))).to.deep.equal(['upgrade', 'azd']);
            });

            it('should use powershell script on Windows when no package manager is available', async () => {
                setPlatform('win32');
                const isOnPathFn = mock.fn(() => Promise.resolve(false));
                const { service, spawnMock } = createService(makeOldVersionSpawn(), isOnPathFn);

                await service.install();

                const opts = spawnMock.mock.calls[1].arguments[0] as SpawnOpts;
                expect(argToString(opts.command[0])).to.equal('powershell');
                expect(argsToStrings(opts.command.slice(1))).to.include('-ExecutionPolicy');
                expect(argsToStrings(opts.command.slice(1))).to.include('AllSigned');
            });

            it('should use brew on macOS when brew is available', async () => {
                setPlatform('darwin');
                const isOnPathFn = mock.fn((cmd: string) => Promise.resolve(cmd === 'brew'));
                const { service, spawnMock } = createService(makeOldVersionSpawn(), isOnPathFn);

                await service.install();

                const opts = spawnMock.mock.calls[1].arguments[0] as SpawnOpts;
                expect(argToString(opts.command[0])).to.equal('brew');
                expect(argsToStrings(opts.command.slice(1))).to.deep.equal(['install', 'azure/azd/azd']);
            });

            it('should use bash curl script on macOS when brew is unavailable', async () => {
                setPlatform('darwin');
                const isOnPathFn = mock.fn(() => Promise.resolve(false));
                const { service, spawnMock } = createService(makeOldVersionSpawn(), isOnPathFn);

                await service.install();

                const opts = spawnMock.mock.calls[1].arguments[0] as SpawnOpts;
                expect(argToString(opts.command[0])).to.equal('bash');
                expect(argsToStrings(opts.command.slice(1)).join(' ')).to.include('install-azd.sh');
            });

            it('should use bash curl script on Linux', async () => {
                setPlatform('linux');
                const isOnPathFn = mock.fn(() => Promise.resolve(false));
                const { service, spawnMock } = createService(makeOldVersionSpawn(), isOnPathFn);

                await service.install();

                const opts = spawnMock.mock.calls[1].arguments[0] as SpawnOpts;
                expect(argToString(opts.command[0])).to.equal('bash');
                expect(argsToStrings(opts.command.slice(1)).join(' ')).to.include('install-azd.sh');
            });
        });
    });
});
