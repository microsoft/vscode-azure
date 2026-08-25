/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, createTestActionExecutor, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { SwaDebugConfigurationProvider } from '../../src/debug/staticWebApps/SwaDebugConfigurationProvider';

describe('SwaDebugConfigurationProvider (unit)', () => {
    it('should generate exact named config and detected browser launches', async () => {
        const mockResult = createMockVsCode();
        const root = mockResult.vscode.Uri.file('/workspace');
        const folder = { uri: root, name: 'workspace', index: 0 } as vscode.WorkspaceFolder;
        mockResult.fs.addFile(
            mockResult.vscode.Uri.joinPath(root, 'swa-cli.config.json'),
            JSON.stringify({ configurations: { named: { appLocation: 'client' } } }),
        );
        mockResult.fs.addFile(
            mockResult.vscode.Uri.joinPath(root, 'client', 'package.json'),
            JSON.stringify({ dependencies: { react: '19.0.0' } }),
        );
        const sendTelemetryErrorEvent = mock.fn();
        const { executor } = createTestActionExecutor({
            reporter: {
                sendTelemetryErrorEvent,
                dispose: () => Promise.resolve(),
            },
        });
        const provider = new SwaDebugConfigurationProvider(
            mockResult.vscode,
            executor,
        );

        const configurations = await provider.provideDebugConfigurations(folder);

        expect(configurations).to.deep.equal([
            {
                name: 'SWA: Run named (swa-cli.config.json)',
                request: 'launch',
                type: 'pwa-chrome',
                url: 'http://localhost:4280',
                preLaunchTask: 'swa: start named',
                // eslint-disable-next-line no-template-curly-in-string
                webRoot: '${workspaceFolder}/client',
                timeout: 30000,
            },
            {
                name: 'SWA: Run client',
                request: 'launch',
                type: 'pwa-chrome',
                url: 'http://localhost:4280',
                preLaunchTask: 'swa: start client',
                // eslint-disable-next-line no-template-curly-in-string
                webRoot: '${workspaceFolder}/client',
                timeout: 30000,
            },
        ]);
        expect(sendTelemetryErrorEvent.mock.calls[0].arguments[0])
            .to.equal('staticWebApps.provideDebugConfigurations');
        expect(sendTelemetryErrorEvent.mock.calls[0].arguments[1]).to.include({
            buildPresets: 'react',
            isActivationEvent: 'true',
            result: 'Succeeded',
        });
        expect(sendTelemetryErrorEvent.mock.calls[0].arguments[2]).to.include({
            configsCount: 1,
            appCount: 1,
            generatedCount: 2,
        });
    });

    it('should ignore unrelated browser configurations without validating the CLI', async () => {
        const mockResult = createMockVsCode();
        const sendTelemetryErrorEvent = mock.fn();
        const { executor } = createTestActionExecutor({
            reporter: {
                sendTelemetryErrorEvent,
                dispose: () => Promise.resolve(),
            },
        });
        const provider = new SwaDebugConfigurationProvider(
            mockResult.vscode,
            executor,
        );
        const configuration = { name: 'Launch Chrome', request: 'launch', type: 'pwa-chrome' };

        expect(await provider.resolveDebugConfiguration(
            undefined,
            configuration,
            { isCancellationRequested: false } as vscode.CancellationToken,
        )).to.equal(configuration);
        expect(sendTelemetryErrorEvent.mock.callCount()).to.equal(0);
    });

    it('should fix a named Functions proxy config and start an attach configuration', async () => {
        const mockResult = createMockVsCode();
        const root = mockResult.vscode.Uri.file('/workspace');
        const folder = { uri: root, name: 'workspace', index: 0 } as vscode.WorkspaceFolder;
        const configUri = mockResult.vscode.Uri.joinPath(root, 'swa-cli.config.json');
        mockResult.fs.addFile(
            configUri,
            JSON.stringify({ configurations: { named: { appLocation: '/', apiLocation: 'api' } } }),
        );
        mockResult.fs.addFile(mockResult.vscode.Uri.joinPath(root, 'api', 'host.json'), '{}');
        mockResult.settings.set('launch.configurations', [
            { name: 'Attach to Node Functions', request: 'attach', type: 'node' },
        ]);
        respondToPrompts(mockResult, [{ button: 'Fix' }]);
        const sendTelemetryErrorEvent = mock.fn();
        const { executor } = createTestActionExecutor({
            reporter: {
                sendTelemetryErrorEvent,
                dispose: () => Promise.resolve(),
            },
        });
        const provider = new SwaDebugConfigurationProvider(
            mockResult.vscode,
            executor,
        );

        await provider.resolveDebugConfiguration(
            folder,
            {
                name: 'SWA: Run named (swa-cli.config.json)',
                request: 'launch',
                type: 'pwa-chrome',
            },
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        const saved = JSON.parse(new TextDecoder().decode(mockResult.fs.files.get(configUri.path))) as {
            configurations: { named: { apiLocation: string } };
        };
        expect(saved.configurations.named.apiLocation).to.equal('http://localhost:7071');
        expect(mockResult.debug.startDebugging.mock.callCount()).to.equal(1);
        expect(mockResult.commands.executeCommand.mock.callCount()).to.equal(0);
        expect(sendTelemetryErrorEvent.mock.calls[0].arguments[0])
            .to.equal('staticWebApps.resolveDebugConfiguration');
        expect(sendTelemetryErrorEvent.mock.calls[0].arguments[1]).to.include({
            hasApi: 'true',
            hasSwaCliConfigFile: 'true',
            functionsProxyFix: 'fixed',
            debugApi: 'true',
            resolveOutcome: 'resolved',
            result: 'Succeeded',
        });
    });
});
