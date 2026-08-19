/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionExecutor, IExtensionContext, IOutputChannel, IVsCode } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, createTestActionExecutor, MockOutputChannel } from '@microsoft/vscode-azure-utils/testing';
import { Container } from 'inversify';
import { mock } from 'node:test';
import { SwaDebugConfigurationProvider } from '../../src/debug/staticWebApps/SwaDebugConfigurationProvider';
import { GitHubActionLogContentProvider } from '../../src/staticWebApps/GitHubActionLogContentProvider';
import { registerStaticWebAppLocalTools } from '../../src/staticWebApps/registerStaticWebAppLocalTools';
import { ISwaCliService } from '../../src/staticWebApps/SwaCliService';
import { SwaTaskLifecycle } from '../../src/tasks/staticWebApps/SwaTaskLifecycle';
import { SwaTaskProvider } from '../../src/tasks/staticWebApps/SwaTaskProvider';

describe('registerStaticWebAppLocalTools (unit)', () => {
    function setup() {
        const mockResult = createMockVsCode();
        const subscriptions: { dispose(): void }[] = [];
        const contentProvider = new GitHubActionLogContentProvider(mockResult.vscode);
        const warnIfOutdated = mock.fn(() => Promise.resolve());
        const container = new Container();
        container.bind(IVsCode).toConstantValue(mockResult.vscode);
        container.bind(IExtensionContext).toConstantValue({ subscriptions } as never);
        container.bind(IOutputChannel).toConstantValue(new MockOutputChannel('test'));
        container.bind(IActionExecutor).toConstantValue(createTestActionExecutor().executor);
        container.bind(SwaTaskProvider).toConstantValue({} as SwaTaskProvider);
        container.bind(SwaDebugConfigurationProvider).toConstantValue({} as SwaDebugConfigurationProvider);
        container.bind(GitHubActionLogContentProvider).toConstantValue(contentProvider);
        container.bind(SwaTaskLifecycle).toConstantValue({ dispose: () => { /* noop */ } } as SwaTaskLifecycle);
        container.bind(ISwaCliService).toConstantValue({ warnIfOutdated } as never);

        return { mockResult, subscriptions, contentProvider, container, warnIfOutdated };
    }

    it('should register task, debug, content, folding, and lifecycle services', () => {
        const { mockResult, subscriptions, contentProvider, container } = setup();

        registerStaticWebAppLocalTools(container);

        expect(mockResult.tasks.registerTaskProvider.mock.calls[0].arguments[0]).to.equal('shell');
        const debugCalls = mockResult.debug.registerDebugConfigurationProvider.mock.calls;
        expect(debugCalls.map(call => call.arguments[0])).to.deep.equal([
            'pwa-chrome', 'swa', 'swa',
        ]);
        expect(debugCalls[1].arguments[2]).to.equal(
            mockResult.vscode.DebugConfigurationProviderTriggerKind.Dynamic,
        );
        expect(debugCalls[2].arguments[2]).to.equal(
            mockResult.vscode.DebugConfigurationProviderTriggerKind.Initial,
        );
        expect(mockResult.workspace.registerTextDocumentContentProvider.mock.calls[0].arguments[0])
            .to.equal('github-action-log');
        expect(mockResult.languages.registerFoldingRangeProvider.mock.callCount()).to.equal(1);
        expect(subscriptions).to.have.lengthOf(6);
        contentProvider.dispose();
    });

    it('should skip the CLI update check when no workspace folder holds a static web app', async () => {
        const { mockResult, contentProvider, container, warnIfOutdated } = setup();
        mockResult.workspaceFolders.push(
            { uri: mockResult.vscode.Uri.file('/workspace'), name: 'workspace', index: 0 },
        );

        registerStaticWebAppLocalTools(container);
        await Promise.resolve();
        await Promise.resolve();

        expect(warnIfOutdated.mock.callCount()).to.equal(0);
        contentProvider.dispose();
    });

    it('should run the CLI update check when a workspace folder holds a static web app', async () => {
        const { mockResult, contentProvider, container, warnIfOutdated } = setup();
        const folder = mockResult.vscode.Uri.file('/workspace');
        mockResult.workspaceFolders.push({ uri: folder, name: 'workspace', index: 0 });
        mockResult.fs.addFile(mockResult.vscode.Uri.joinPath(folder, 'swa-cli.config.json'));

        registerStaticWebAppLocalTools(container);
        await waitForCallCount(warnIfOutdated);

        expect(warnIfOutdated.mock.callCount()).to.equal(1);
        contentProvider.dispose();
    });
});

async function waitForCallCount(fn: { mock: { callCount(): number } }): Promise<void> {
    for (let attempt = 0; attempt < 100 && fn.mock.callCount() === 0; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}
