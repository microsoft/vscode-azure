/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    BackgroundJsonLinesProcessOptions,
    BackgroundJsonProcessOptions,
    BackgroundProcessOptions,
    ForegroundProcessOptions,
    IProcessExecutor,
    JsonLinesProcessResult,
    JsonProcessResult,
    ProcessResult,
} from '@microsoft/vscode-azure-utils';
import { argsToStrings } from '@microsoft/vscode-azure-utils';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import {
    ToolAcquisitionError,
    ToolAcquisitionService,
    validateToolAcquisitionRequest,
    type ToolDefinition,
    type ToolInstallStrategy,
    type ToolRuntime,
} from '../../src/tools/ToolAcquisition';
import { createAzdToolDefinition } from '../../src/tools/azdTool';

describe('ToolAcquisitionService (unit)', () => {
    const runtime: ToolRuntime = {
        platform: 'linux',
        architecture: 'x64',
        env: {},
    };

    it('resolves and verifies an existing executable without installing', async () => {
        const process = new MockProcessExecutor('/tools/azd');
        const definition = createDefinition(new Map([['/tools/azd', '1.25.1']]));
        const service = new ToolAcquisitionService(createMockVsCode().vscode, process, [definition], runtime);

        const result = await service.acquire({
            toolId: 'azd',
            requestingExtensionId: 'microsoft.test-extension',
            versionRange: '>=1.25.0-0',
        });

        expect(result).to.deep.equal({
            toolId: 'azd',
            executablePath: '/tools/azd',
            version: '1.25.1',
            method: 'path',
            installed: false,
        });
        expect(service.getResolvedPath('azd')).to.equal('/tools/azd');
        expect(process.foregroundCalls).to.be.empty;
    });

    it('installs and re-probes when the existing version does not satisfy the range', async () => {
        const process = new MockProcessExecutor('/tools/azd');
        const versions = new Map([['/tools/azd', '1.24.0']]);
        process.onForeground = () => { versions.set('/tools/azd', '1.26.0'); };
        const definition = createDefinition(versions, [{
            method: 'officialScript',
            command: ['install-azd'],
            signatureVerified: false,
        }]);
        const service = new ToolAcquisitionService(createMockVsCode().vscode, process, [definition], runtime);

        const result = await service.acquire({
            toolId: 'azd',
            requestingExtensionId: 'microsoft.test-extension',
            versionRange: '>=1.25.0-0',
        });

        expect(result.version).to.equal('1.26.0');
        expect(result.method).to.equal('officialScript');
        expect(result.installed).to.equal(true);
        expect(process.foregroundCalls).to.have.length(1);
    });

    it('rejects an unverifiable strategy when signature verification is explicit', async () => {
        const process = new MockProcessExecutor();
        const definition = createDefinition(new Map(), [{
            method: 'officialScript',
            command: ['install-azd'],
            signatureVerified: false,
        }]);
        const service = new ToolAcquisitionService(createMockVsCode().vscode, process, [definition], runtime);

        await expect(service.acquire({
            toolId: 'azd',
            requestingExtensionId: 'microsoft.test-extension',
            requireSignature: true,
        })).to.be.rejectedWith(ToolAcquisitionError, 'No verified installation method');
        expect(process.foregroundCalls).to.be.empty;
    });

    it('preserves cancellation instead of returning an acquisition failure', async () => {
        const process = new MockProcessExecutor();
        const service = new ToolAcquisitionService(
            createMockVsCode().vscode,
            process,
            [createDefinition(new Map())],
            runtime,
        );
        const controller = new AbortController();
        controller.abort();

        await expect(service.acquire({
            toolId: 'azd',
            requestingExtensionId: 'microsoft.test-extension',
            cancellationToken: controller.signal,
        })).to.be.rejectedWith('Canceled');
    });

    it('warns but permits an unverifiable strategy when signature verification is implicit', async () => {
        const process = new MockProcessExecutor();
        const versions = new Map<string, string>();
        process.onForeground = () => {
            process.executablePath = '/tools/azd';
            versions.set('/tools/azd', '1.25.0');
        };
        const definition = createDefinition(versions, [{
            method: 'officialScript',
            command: ['install-azd'],
            signatureVerified: false,
        }]);
        const progress = mock.fn();
        const service = new ToolAcquisitionService(createMockVsCode().vscode, process, [definition], runtime);

        await service.acquire({
            toolId: 'azd',
            requestingExtensionId: 'microsoft.test-extension',
            progress: { report: progress },
        });

        expect(progress.mock.calls.some(call => call.arguments[0].warning === true)).to.equal(true);
    });

    it('coalesces concurrent equivalent install requests', async () => {
        const process = new MockProcessExecutor();
        const versions = new Map<string, string>();
        let releaseInstall: (() => void) | undefined;
        process.onForeground = () => new Promise<void>(resolve => {
            releaseInstall = () => {
                process.executablePath = '/tools/azd';
                versions.set('/tools/azd', '1.25.0');
                resolve();
            };
        });
        const definition = createDefinition(versions, [{
            method: 'officialScript',
            command: ['install-azd'],
            signatureVerified: false,
        }]);
        const service = new ToolAcquisitionService(createMockVsCode().vscode, process, [definition], runtime);
        const firstProgress = mock.fn();
        const secondProgress = mock.fn();
        const request = {
            toolId: 'azd' as const,
            requestingExtensionId: 'microsoft.test-extension',
        };

        const first = service.acquire({ ...request, progress: { report: firstProgress } });
        const second = service.acquire({ ...request, progress: { report: secondProgress } });
        await waitFor(() => releaseInstall !== undefined);
        releaseInstall?.();

        expect(await first).to.deep.equal(await second);
        expect(process.foregroundCalls).to.have.length(1);
        expect(firstProgress.mock.callCount()).to.be.greaterThan(0);
        expect(secondProgress.mock.callCount()).to.be.greaterThan(0);
    });

    it('does not cancel shared work while another caller is still waiting', async () => {
        const process = new MockProcessExecutor();
        const versions = new Map<string, string>();
        let releaseInstall: (() => void) | undefined;
        process.onForeground = () => new Promise<void>(resolve => {
            releaseInstall = () => {
                process.executablePath = '/tools/azd';
                versions.set('/tools/azd', '1.25.0');
                resolve();
            };
        });
        const definition = createDefinition(versions, [{
            method: 'officialScript',
            command: ['install-azd'],
            signatureVerified: false,
        }]);
        const service = new ToolAcquisitionService(createMockVsCode().vscode, process, [definition], runtime);
        const controller = new AbortController();
        const request = {
            toolId: 'azd' as const,
            requestingExtensionId: 'microsoft.test-extension',
        };

        const cancelled = service.acquire({ ...request, cancellationToken: controller.signal });
        const remaining = service.acquire(request);
        await waitFor(() => releaseInstall !== undefined);
        controller.abort();
        await expect(cancelled).to.be.rejectedWith('Canceled');
        releaseInstall?.();

        expect((await remaining).executablePath).to.equal('/tools/azd');
        expect(process.foregroundCalls).to.have.length(1);
    });

    it('rejects a target architecture that differs from the extension host', async () => {
        const service = new ToolAcquisitionService(
            createMockVsCode().vscode,
            new MockProcessExecutor('/tools/azd'),
            [createDefinition(new Map([['/tools/azd', '1.25.0']]))],
            runtime,
        );

        await expect(service.acquire({
            toolId: 'azd',
            requestingExtensionId: 'microsoft.test-extension',
            architecture: 'arm64',
        })).to.be.rejectedWith(ToolAcquisitionError, 'does not match the extension host architecture');
    });
});

describe('validateToolAcquisitionRequest (unit)', () => {
    it('accepts the supported request shape', () => {
        const result = validateToolAcquisitionRequest({
            toolId: 'azd',
            requestingExtensionId: 'microsoft.test-extension',
            versionRange: '>=1.25.0-0',
            architecture: 'arm64',
            options: {},
        });

        expect(result.toolId).to.equal('azd');
        expect(result.architecture).to.equal('arm64');
    });

    it('rejects unknown tool-specific options', () => {
        expect(() => validateToolAcquisitionRequest({
            toolId: 'azd',
            requestingExtensionId: 'microsoft.test-extension',
            options: { unexpected: true },
        })).to.throw(ToolAcquisitionError, 'Unknown azd options field');
    });

    it('rejects invalid semver ranges', () => {
        expect(() => validateToolAcquisitionRequest({
            toolId: 'azd',
            requestingExtensionId: 'microsoft.test-extension',
            versionRange: 'not a range',
        })).to.throw(ToolAcquisitionError, 'versionRange');
    });
});

describe('createAzdToolDefinition (unit)', () => {
    it('prefers azd update when the existing version supports it', () => {
        const process = new MockProcessExecutor();
        const definition = createAzdToolDefinition();

        const strategies = definition.getInstallStrategies({
            runtime: { platform: 'win32', architecture: 'x64', env: {} },
            architecture: 'x64',
            current: {
                executablePath: 'C:\\tools\\azd.exe',
                version: '1.23.14',
                method: 'knownPath',
            },
            processExecutor: process,
        });

        expect(strategies[0].method).to.equal('azdUpdate');
        expect(argsToStrings(strategies[0].command)).to.deep.equal(['C:\\tools\\azd.exe', 'update']);
        expect(strategies[0].signatureVerified).to.equal(true);
    });

    it('prefers winget and retains the official script as a fallback on Windows', () => {
        const process = new MockProcessExecutor();
        process.commandsOnPath.add('winget');
        const definition = createAzdToolDefinition();

        const strategies = definition.getInstallStrategies({
            runtime: { platform: 'win32', architecture: 'x64', env: {} },
            architecture: 'x64',
            processExecutor: process,
        });

        expect(strategies.map(strategy => strategy.method)).to.deep.equal(['winget', 'officialScript']);
        expect(argsToStrings(strategies[0].command)).to.deep.equal(['winget', 'install', 'microsoft.azd']);
    });

    it('uses Homebrew before the official script on macOS', () => {
        const process = new MockProcessExecutor();
        process.commandsOnPath.add('brew');
        const definition = createAzdToolDefinition();

        const strategies = definition.getInstallStrategies({
            runtime: { platform: 'darwin', architecture: 'arm64', env: {} },
            architecture: 'arm64',
            processExecutor: process,
        });

        expect(strategies.map(strategy => strategy.method)).to.deep.equal(['homebrew', 'officialScript']);
    });

    it('probes the executable using azd JSON output', async () => {
        const process = new MockProcessExecutor();
        process.backgroundJson = { azd: { version: '1.25.0' } };
        const definition = createAzdToolDefinition();

        const version = await definition.probeVersion('/tools/azd', process);

        expect(version).to.equal('1.25.0');
        expect(argsToStrings(process.backgroundCalls[0].command)).to.deep.equal([
            '/tools/azd',
            'version',
            '--output',
            'json',
        ]);
    });
});

function createDefinition(
    versions: ReadonlyMap<string, string>,
    strategies: readonly ToolInstallStrategy[] = [],
): ToolDefinition {
    return {
        id: 'azd',
        displayName: 'Azure Developer CLI',
        executableName: 'azd',
        getKnownPaths: () => [],
        probeVersion: (executablePath) => Promise.resolve(versions.get(executablePath)),
        getInstallStrategies: () => strategies,
    };
}

class MockProcessExecutor implements IProcessExecutor {
    public readonly foregroundCalls: ForegroundProcessOptions[] = [];
    public readonly backgroundCalls: (BackgroundJsonLinesProcessOptions | BackgroundJsonProcessOptions | BackgroundProcessOptions)[] = [];
    public readonly commandsOnPath = new Set<string>();
    public backgroundJson: unknown;
    public onForeground: () => void | Promise<void> = () => undefined;

    public constructor(public executablePath?: string) {
    }

    public spawn(options: ForegroundProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<void>;
    public spawn<TOut = unknown, TLines = unknown>(options: BackgroundJsonLinesProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<JsonLinesProcessResult<TOut, TLines>>;
    public spawn<T = unknown>(options: BackgroundJsonProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<JsonProcessResult<T>>;
    public spawn(options: BackgroundProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<ProcessResult>;
    public async spawn(
        options: ForegroundProcessOptions | BackgroundJsonLinesProcessOptions | BackgroundJsonProcessOptions | BackgroundProcessOptions,
        _cancellation?: vscode.CancellationToken | AbortSignal,
    ): Promise<void | ProcessResult | JsonProcessResult<unknown> | JsonLinesProcessResult> {
        if (options.execution === 'foreground') {
            this.foregroundCalls.push(options);
            await this.onForeground();
            return;
        }
        this.backgroundCalls.push(options);
        if ('parseJson' in options && options.parseJson) {
            return { stdout: '', stderr: '', json: this.backgroundJson };
        }
        return { stdout: '', stderr: '' };
    }

    public resolveExecutable(_command: string): string | undefined {
        return this.executablePath;
    }

    public isOnPath(command: string): boolean {
        return this.commandsOnPath.has(command);
    }
}

async function waitFor(predicate: () => boolean): Promise<void> {
    while (!predicate()) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}
