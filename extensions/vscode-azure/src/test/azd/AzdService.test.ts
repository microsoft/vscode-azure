/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IProcessExecutor, type JsonLinesProcessResult, type SpawnFn, type TerminalProcessResult } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import type { IAzdAuthServer } from '../../azd/AzdAuthServer';
import { AzdService, parseDeploymentIdFromOutput, parseEndpointUrlsFromOutput } from '../../azd/AzdService';

interface SpawnOpts {
    execution: string;
    command: string;
    args: Array<string | { value: string; quoting: number }>;
    cwd: { path: string };
    parseJson?: boolean;
    name?: string;
    source?: string;
    alwaysRunNew?: boolean;
    focus?: boolean;
}

/** Extracts plain string values from a command line args array. */
function argValues(args: SpawnOpts['args']): string[] {
    return args.map(a => typeof a === 'string' ? a : a.value);
}

function createService(spawnFn?: SpawnFn) {
    const mockResult = createMockVsCode();
    const spawnMock = spawnFn ?? mock.fn(() => Promise.resolve({ stdout: '', stderr: '' }));
    const processExecutor = { spawn: spawnMock } as unknown as IProcessExecutor;
    const authServer: IAzdAuthServer = { getEnv: mock.fn(() => Promise.resolve({})) };
    const service = new AzdService(mockResult.vscode, processExecutor, authServer);
    return { service, spawnMock: spawnMock as ReturnType<typeof mock.fn>, fs: mockResult.fs };
}

describe('AzdService (unit)', () => {
    describe('findAzureYaml', () => {
        it('should return azure.yaml URI when it exists', async () => {
            const { service, fs } = createService();
            fs.addFile(MockUri.file('/project/azure.yaml'));

            const result = await service.findAzureYaml(MockUri.file('/project') as unknown as vscode.Uri);

            expect(result).to.not.be.undefined;
            expect(result!.path).to.equal('/project/azure.yaml');
        });

        it('should return azure.yml URI when azure.yaml does not exist', async () => {
            const { service, fs } = createService();
            fs.addFile(MockUri.file('/project/azure.yml'));

            const result = await service.findAzureYaml(MockUri.file('/project') as unknown as vscode.Uri);

            expect(result).to.not.be.undefined;
            expect(result!.path).to.equal('/project/azure.yml');
        });

        it('should prefer azure.yaml over azure.yml when both exist', async () => {
            const { service, fs } = createService();
            fs.addFile(MockUri.file('/project/azure.yaml'));
            fs.addFile(MockUri.file('/project/azure.yml'));

            const result = await service.findAzureYaml(MockUri.file('/project') as unknown as vscode.Uri);

            expect(result!.path).to.equal('/project/azure.yaml');
        });

        it('should return undefined when neither file exists', async () => {
            const { service } = createService();

            const result = await service.findAzureYaml(MockUri.file('/project') as unknown as vscode.Uri);

            expect(result).to.be.undefined;
        });
    });

    describe('init', () => {
        it('should spawn azd init with --minimal and --no-prompt', async () => {
            const { service, spawnMock } = createService();

            await service.init(MockUri.file('/project') as unknown as vscode.Uri);

            expect(spawnMock.mock.callCount()).to.equal(1);
            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(opts.execution).to.equal('background');
            expect(opts.command).to.equal('azd');
            expect(argValues(opts.args)).to.include('init');
            expect(argValues(opts.args)).to.include('--minimal');
            expect(argValues(opts.args)).to.include('--no-prompt');
            expect(opts.cwd.path).to.equal('/project');
        });
    });

    describe('envNew', () => {
        it('should spawn azd env new with name, location, and subscription', async () => {
            const { service, spawnMock } = createService();

            await service.envNew('dev', 'eastus', 'sub-1', MockUri.file('/project') as unknown as vscode.Uri);

            expect(spawnMock.mock.callCount()).to.equal(1);
            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(opts.execution).to.equal('background');
            expect(opts.command).to.equal('azd');
            expect(argValues(opts.args)).to.include('env');
            expect(argValues(opts.args)).to.include('new');
            expect(argValues(opts.args)).to.include('dev');
            expect(argValues(opts.args)).to.include('--location');
            expect(argValues(opts.args)).to.include('eastus');
            expect(argValues(opts.args)).to.include('--subscription');
            expect(argValues(opts.args)).to.include('sub-1');
            expect(opts.cwd.path).to.equal('/project');
        });
    });

    describe('envExists', () => {
        it('should return true when an environment with the given name is in envList', async () => {
            const envs = [{ Name: 'dev', IsDefault: true }, { Name: 'prod', IsDefault: false }];
            const spawnFn = mock.fn(() => Promise.resolve({ json: envs }));
            const { service } = createService(spawnFn as unknown as SpawnFn);

            const result = await service.envExists('prod', MockUri.file('/project') as unknown as vscode.Uri);

            expect(result).to.be.true;
        });

        it('should return false when no environment with the given name exists', async () => {
            const envs = [{ Name: 'dev', IsDefault: true }];
            const spawnFn = mock.fn(() => Promise.resolve({ json: envs }));
            const { service } = createService(spawnFn as unknown as SpawnFn);

            const result = await service.envExists('missing', MockUri.file('/project') as unknown as vscode.Uri);

            expect(result).to.be.false;
        });

        it('should return false when envList rejects (azd not installed)', async () => {
            const enoent = Object.assign(new Error('spawn azd ENOENT'), { code: 'ENOENT' });
            const spawnFn = mock.fn(() => Promise.reject(enoent));
            const { service } = createService(spawnFn);

            const result = await service.envExists('dev', MockUri.file('/project') as unknown as vscode.Uri);

            expect(result).to.be.false;
        });
    });

    describe('envList', () => {
        it('should spawn azd env list with --output json and return parsed result', async () => {
            const envs = [{ Name: 'dev', IsDefault: true }];
            const spawnFn = mock.fn(() => Promise.resolve({ json: envs }));
            const { service, spawnMock } = createService(spawnFn as unknown as SpawnFn);

            const result = await service.envList(MockUri.file('/project') as unknown as vscode.Uri);

            expect(result).to.deep.equal(envs);
            expect(spawnMock.mock.callCount()).to.equal(1);
            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(opts.execution).to.equal('background');
            expect(argValues(opts.args)).to.include('env');
            expect(argValues(opts.args)).to.include('list');
            expect(argValues(opts.args)).to.include('--output');
            expect(argValues(opts.args)).to.include('json');
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
            const { service, spawnMock } = createService(spawnFn as unknown as SpawnFn);

            const result = await service.envGetValues('dev', MockUri.file('/project') as unknown as vscode.Uri);

            expect(result).to.deep.equal(values);
            expect(spawnMock.mock.callCount()).to.equal(1);
            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(opts.execution).to.equal('background');
            expect(opts.command).to.equal('azd');
            expect(argValues(opts.args)).to.include('env');
            expect(argValues(opts.args)).to.include('get-values');
            expect(argValues(opts.args)).to.include('--environment');
            expect(argValues(opts.args)).to.include('dev');
            expect(argValues(opts.args)).to.include('--output');
            expect(argValues(opts.args)).to.include('json');
            expect(opts.parseJson).to.be.true;
            expect(opts.cwd.path).to.equal('/project');
        });

        it('should return an empty object when the spawn fails (best-effort)', async () => {
            const spawnFn = mock.fn(() => Promise.reject(new Error('env not found')));
            const { service } = createService(spawnFn);

            const result = await service.envGetValues('dev', MockUri.file('/project') as unknown as vscode.Uri);

            expect(result).to.deep.equal({});
        });

        it('should return an empty object when azd is not installed (ENOENT)', async () => {
            const enoent = Object.assign(new Error('spawn azd ENOENT'), { code: 'ENOENT' });
            const spawnFn = mock.fn(() => Promise.reject(enoent));
            const { service } = createService(spawnFn);

            const result = await service.envGetValues('dev', MockUri.file('/project') as unknown as vscode.Uri);

            expect(result).to.deep.equal({});
        });
    });

    describe('show', () => {
        it('should spawn azd show with --output json and return parsed result', async () => {
            const payload = {
                name: 'my-app',
                services: { myfunc: { project: { path: '/project', language: 'node' } } },
            };
            const spawnFn = mock.fn(() => Promise.resolve({ json: payload }));
            const { service, spawnMock } = createService(spawnFn as unknown as SpawnFn);

            const result = await service.show(MockUri.file('/project') as unknown as vscode.Uri);

            expect(result).to.deep.equal(payload);
            expect(spawnMock.mock.callCount()).to.equal(1);
            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(opts.execution).to.equal('background');
            expect(opts.command).to.equal('azd');
            expect(argValues(opts.args)).to.include('show');
            expect(argValues(opts.args)).to.include('--output');
            expect(argValues(opts.args)).to.include('json');
            expect(opts.parseJson).to.be.true;
            expect(opts.cwd.path).to.equal('/project');
        });

        it('should return undefined when the spawn fails (no azure.yaml in cwd)', async () => {
            const spawnFn = mock.fn(() => Promise.reject(new Error('no azure.yaml')));
            const { service } = createService(spawnFn);

            const result = await service.show(MockUri.file('/project') as unknown as vscode.Uri);

            expect(result).to.be.undefined;
        });

        it('should return undefined when azd is not installed (ENOENT)', async () => {
            const enoent = Object.assign(new Error('spawn azd ENOENT'), { code: 'ENOENT' });
            const spawnFn = mock.fn(() => Promise.reject(enoent));
            const { service } = createService(spawnFn);

            const result = await service.show(MockUri.file('/project') as unknown as vscode.Uri);

            expect(result).to.be.undefined;
        });
    });

    describe('ENOENT handling', () => {
        it('should wrap ENOENT errors with an install hint', async () => {
            const enoent = Object.assign(new Error('spawn azd ENOENT'), { code: 'ENOENT' });
            const spawnFn = mock.fn(() => Promise.reject(enoent));
            const { service } = createService(spawnFn);

            try {
                await service.init(MockUri.file('/project') as unknown as vscode.Uri);
                expect.fail('Expected error');
            } catch (e) {
                expect((e as Error).message).to.include('Azure Developer CLI (azd) was not found');
                expect((e as Error).cause).to.equal(enoent);
            }
        });

        it('should rethrow non-ENOENT errors as-is', async () => {
            const other = new Error('something else');
            const spawnFn = mock.fn(() => Promise.reject(other));
            const { service } = createService(spawnFn);

            try {
                await service.init(MockUri.file('/project') as unknown as vscode.Uri);
                expect.fail('Expected error');
            } catch (e) {
                expect(e).to.equal(other);
            }
        });
    });

    describe('provisionWithCapture', () => {
        it('should throw when azure.yaml is not found', async () => {
            const { service } = createService();

            try {
                await service.provisionWithCapture(MockUri.file('/project') as unknown as vscode.Uri);
                expect.fail('Expected error');
            } catch (e) {
                expect((e as Error).message).to.include('azure.yaml');
            }
        });

        it('should spawn terminal execution with auth env', async () => {
            const terminalResult = createMockTerminalResult(['output']);
            const spawnFn = mock.fn(() => Promise.resolve(terminalResult));
            const { service, spawnMock, fs } = createService(spawnFn as unknown as SpawnFn);
            fs.addFile(MockUri.file('/project/azure.yaml'));

            const result = await service.provisionWithCapture(MockUri.file('/project') as unknown as vscode.Uri);
            await result.completed;

            expect(spawnMock.mock.callCount()).to.equal(1);
            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(opts.execution).to.equal('terminal');
            expect(opts.command).to.equal('azd');
            expect(argValues(opts.args)).to.include('provision');
        });

        it('should extract deployment info from terminal output containing a portal URL', async () => {
            const portalUrl = 'https://portal.azure.com/#view/HubsExtension/DeploymentDetailsBlade/~/overview/id/%2Fsubscriptions%2Fsub-1%2FresourceGroups%2Frg1%2Fproviders%2FMicrosoft.Resources%2Fdeployments%2Fdeploy-1';
            const terminalResult = createMockTerminalResult([`Provisioning: ${portalUrl}`]);
            const spawnFn = mock.fn(() => Promise.resolve(terminalResult));
            const { service, fs } = createService(spawnFn as unknown as SpawnFn);
            fs.addFile(MockUri.file('/project/azure.yaml'));

            const result = await service.provisionWithCapture(MockUri.file('/project') as unknown as vscode.Uri);
            await result.completed;

            const info = await result.deploymentInfo;
            expect(info).to.not.be.undefined;
            expect(info!.subscriptionId).to.equal('sub-1');
            expect(info!.deploymentId).to.include('deploy-1');
        });

        it('should resolve deploymentInfo to undefined when no portal URL in output', async () => {
            const terminalResult = createMockTerminalResult(['some output without URLs']);
            const spawnFn = mock.fn(() => Promise.resolve(terminalResult));
            const { service, fs } = createService(spawnFn as unknown as SpawnFn);
            fs.addFile(MockUri.file('/project/azure.yaml'));

            const result = await service.provisionWithCapture(MockUri.file('/project') as unknown as vscode.Uri);
            await result.completed;

            const info = await result.deploymentInfo;
            expect(info).to.be.undefined;
        });

        it('should throw on non-zero exit code from terminal', async () => {
            const terminalResult = createMockTerminalResult([], 1);
            const spawnFn = mock.fn(() => Promise.resolve(terminalResult));
            const { service, fs } = createService(spawnFn as unknown as SpawnFn);
            fs.addFile(MockUri.file('/project/azure.yaml'));

            const result = await service.provisionWithCapture(MockUri.file('/project') as unknown as vscode.Uri);

            try {
                await result.completed;
                expect.fail('Expected error');
            } catch (e) {
                expect((e as Error).message).to.include('azd provision exited with code 1');
            }
        });

        it('should fall back to JSON mode when shell integration is unavailable', async () => {
            const noShellResult: TerminalProcessResult = {
                shellIntegration: false,
                output: (async function* () { /* empty */ })(),
                completed: Promise.resolve({ exitCode: undefined }),
            };
            let callCount = 0;
            const spawnFn = mock.fn(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve(noShellResult);
                }
                // JSON fallback call
                return Promise.resolve(createMockJsonLinesResult([]));
            });
            const { service, spawnMock, fs } = createService(spawnFn as unknown as SpawnFn);
            fs.addFile(MockUri.file('/project/azure.yaml'));

            const result = await service.provisionWithCapture(MockUri.file('/project') as unknown as vscode.Uri);
            await result.completed;

            expect(spawnMock.mock.callCount()).to.equal(2);
            const fallbackOpts = spawnMock.mock.calls[1].arguments[0] as SpawnOpts;
            expect(fallbackOpts.execution).to.equal('background');
            expect(argValues(fallbackOpts.args)).to.include('--output');
            expect(argValues(fallbackOpts.args)).to.include('json');
        });
    });

    describe('deployWithCapture', () => {
        it('should throw when azure.yaml is not found', async () => {
            const { service } = createService();

            try {
                await service.deployWithCapture(MockUri.file('/project') as unknown as vscode.Uri);
                expect.fail('Expected error');
            } catch (e) {
                expect((e as Error).message).to.include('azure.yaml');
            }
        });

        it('should spawn terminal execution for deploy', async () => {
            const terminalResult = createMockTerminalResult([]);
            const spawnFn = mock.fn(() => Promise.resolve(terminalResult));
            const { service, spawnMock, fs } = createService(spawnFn as unknown as SpawnFn);
            fs.addFile(MockUri.file('/project/azure.yaml'));

            const result = await service.deployWithCapture(MockUri.file('/project') as unknown as vscode.Uri);
            await result.completed;

            expect(spawnMock.mock.callCount()).to.equal(1);
            const opts = spawnMock.mock.calls[0].arguments[0] as SpawnOpts;
            expect(opts.execution).to.equal('terminal');
            expect(opts.command).to.equal('azd');
            expect(argValues(opts.args)).to.include('deploy');
        });

        it('should extract endpoint URLs from terminal output', async () => {
            const terminalResult = createMockTerminalResult([
                'Deployed: https://myapp.azurewebsites.net',
                'Also: https://myapi.azurewebsites.net',
            ]);
            const spawnFn = mock.fn(() => Promise.resolve(terminalResult));
            const { service, fs } = createService(spawnFn as unknown as SpawnFn);
            fs.addFile(MockUri.file('/project/azure.yaml'));

            const result = await service.deployWithCapture(MockUri.file('/project') as unknown as vscode.Uri);
            await result.completed;

            expect(result.endpointUrls).to.deep.equal([
                'https://myapp.azurewebsites.net',
                'https://myapi.azurewebsites.net',
            ]);
        });

        it('should deduplicate endpoint URLs', async () => {
            const terminalResult = createMockTerminalResult([
                'Deployed: https://myapp.azurewebsites.net',
                'Again: https://myapp.azurewebsites.net',
            ]);
            const spawnFn = mock.fn(() => Promise.resolve(terminalResult));
            const { service, fs } = createService(spawnFn as unknown as SpawnFn);
            fs.addFile(MockUri.file('/project/azure.yaml'));

            const result = await service.deployWithCapture(MockUri.file('/project') as unknown as vscode.Uri);
            await result.completed;

            expect(result.endpointUrls).to.deep.equal(['https://myapp.azurewebsites.net']);
        });

        it('should throw on non-zero exit code from terminal', async () => {
            const terminalResult = createMockTerminalResult([], 2);
            const spawnFn = mock.fn(() => Promise.resolve(terminalResult));
            const { service, fs } = createService(spawnFn as unknown as SpawnFn);
            fs.addFile(MockUri.file('/project/azure.yaml'));

            const result = await service.deployWithCapture(MockUri.file('/project') as unknown as vscode.Uri);

            try {
                await result.completed;
                expect.fail('Expected error');
            } catch (e) {
                expect((e as Error).message).to.include('azd deploy exited with code 2');
            }
        });

        it('should fall back to JSON mode and extract endpoints from stdout', async () => {
            const noShellResult: TerminalProcessResult = {
                shellIntegration: false,
                output: (async function* () { /* empty */ })(),
                completed: Promise.resolve({ exitCode: undefined }),
            };
            const deployJson = {
                services: {
                    web: {
                        artifacts: [
                            { kind: 'endpoint', location: 'https://myapp.azurewebsites.net' },
                            { kind: 'package', location: '/tmp/package.zip' },
                        ],
                    },
                },
            };
            let callCount = 0;
            const spawnFn = mock.fn(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve(noShellResult);
                }
                return Promise.resolve(createMockJsonLinesResult([], deployJson));
            });
            const { service, fs } = createService(spawnFn as unknown as SpawnFn);
            fs.addFile(MockUri.file('/project/azure.yaml'));

            const result = await service.deployWithCapture(MockUri.file('/project') as unknown as vscode.Uri);
            await result.completed;

            expect(result.endpointUrls).to.deep.equal(['https://myapp.azurewebsites.net']);
        });
    });
});

describe('parseDeploymentIdFromOutput (unit)', () => {
    it('should extract deployment ID from a portal URL', () => {
        const output = 'View in portal: https://portal.azure.com/#view/HubsExtension/DeploymentDetailsBlade/~/overview/id/%2Fsubscriptions%2Fsub-1%2FresourceGroups%2Frg1%2Fproviders%2FMicrosoft.Resources%2Fdeployments%2Fdeploy-1';

        const result = parseDeploymentIdFromOutput(output);

        expect(result).to.not.be.undefined;
        expect(result!.subscriptionId).to.equal('sub-1');
        expect(result!.deploymentId).to.include('deploy-1');
    });

    it('should handle ANSI escape codes in the output', () => {
        const output = '\x1b[32mView in portal: https://portal.azure.com/#view/HubsExtension/DeploymentDetailsBlade/~/overview/id/%2Fsubscriptions%2Fsub-1%2FresourceGroups%2Frg1%2Fproviders%2FMicrosoft.Resources%2Fdeployments%2Fdeploy-1\x1b[0m';

        const result = parseDeploymentIdFromOutput(output);

        expect(result).to.not.be.undefined;
        expect(result!.subscriptionId).to.equal('sub-1');
    });

    it('should return undefined when no portal URL is present', () => {
        expect(parseDeploymentIdFromOutput('no URL here')).to.be.undefined;
    });

    it('should return undefined when the decoded ID is not a valid ARM resource ID', () => {
        const output = 'https://portal.azure.com/#view/HubsExtension/DeploymentDetailsBlade/~/overview/id/not-a-valid-id';

        expect(parseDeploymentIdFromOutput(output)).to.be.undefined;
    });
});

describe('parseEndpointUrlsFromOutput (unit)', () => {
    it('should extract https URLs from output', () => {
        const output = 'Deployed to https://myapp.azurewebsites.net and https://myapi.azurewebsites.net';

        const result = parseEndpointUrlsFromOutput(output);

        expect(result).to.deep.equal([
            'https://myapp.azurewebsites.net',
            'https://myapi.azurewebsites.net',
        ]);
    });

    it('should filter out Azure Portal URLs', () => {
        const output = 'View at https://portal.azure.com/#/resource/... and endpoint https://myapp.azurewebsites.net';

        const result = parseEndpointUrlsFromOutput(output);

        expect(result).to.deep.equal(['https://myapp.azurewebsites.net']);
    });

    it('should filter out sovereign cloud portal URLs', () => {
        const output = 'View at https://portal.azure.cn/#/resource/... or https://portal.azure.us/#/resource/...';

        const result = parseEndpointUrlsFromOutput(output);

        expect(result).to.deep.equal([]);
    });

    it('should filter out aka.ms links', () => {
        const output = 'Learn more at https://aka.ms/azure-dev and endpoint https://myapp.azurewebsites.net';

        const result = parseEndpointUrlsFromOutput(output);

        expect(result).to.deep.equal(['https://myapp.azurewebsites.net']);
    });

    it('should handle ANSI escape codes', () => {
        const output = '\x1b[1mhttps://myapp.azurewebsites.net\x1b[0m';

        const result = parseEndpointUrlsFromOutput(output);

        expect(result).to.deep.equal(['https://myapp.azurewebsites.net']);
    });

    it('should return empty array when no URLs are present', () => {
        expect(parseEndpointUrlsFromOutput('no URLs here')).to.deep.equal([]);
    });
});

// #region Test helpers

/** Creates a mock {@linkcode TerminalProcessResult} with preset output chunks. */
function createMockTerminalResult(chunks: string[], exitCode = 0): TerminalProcessResult {
    return {
        shellIntegration: true,
        output: (async function* () { // eslint-disable-line @typescript-eslint/require-await
            for (const chunk of chunks) {
                yield chunk;
            }
        })(),
        completed: Promise.resolve({ exitCode }),
    };
}

/** Creates a mock {@linkcode JsonLinesProcessResult} for JSON fallback paths. */
function createMockJsonLinesResult<T>(
    stderrLines: Array<{ type?: string; data?: { message?: string } }> = [],
    stdoutJson: T = {} as T,
): JsonLinesProcessResult<T> {
    return {
        jsonLines: (async function* () { // eslint-disable-line @typescript-eslint/require-await
            for (const line of stderrLines) {
                yield line;
            }
        })(),
        completed: Promise.resolve({ stdout: JSON.stringify(stdoutJson), stderr: '', json: stdoutJson }),
    };
}

// #endregion
