/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionContext, IOutputChannel, IVsCode } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, MockOutputChannel } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { Container } from 'inversify';
import { SwaDebugConfigurationProvider } from '../../src/debug/staticWebApps/SwaDebugConfigurationProvider';
import { IStaticWebAppsGitHubService } from '../../src/services/StaticWebAppsGitHubService';
import { GitHubActionLogContentProvider } from '../../src/staticWebApps/GitHubActionLogContentProvider';
import { registerStaticWebAppLocalTools } from '../../src/staticWebApps/registerStaticWebAppLocalTools';
import { ISwaCliService } from '../../src/staticWebApps/SwaCliService';
import { SwaTaskLifecycle } from '../../src/tasks/staticWebApps/SwaTaskLifecycle';
import { SwaTaskProvider } from '../../src/tasks/staticWebApps/SwaTaskProvider';

describe('registerStaticWebAppLocalTools (unit)', () => {
    it('should register task, debug, content, folding, and lifecycle services', () => {
        const mockResult = createMockVsCode();
        const subscriptions: { dispose(): void }[] = [];
        const contentProvider = new GitHubActionLogContentProvider(mockResult.vscode);
        const container = new Container();
        container.bind(IVsCode).toConstantValue(mockResult.vscode);
        container.bind(IExtensionContext).toConstantValue({ subscriptions } as never);
        container.bind(IOutputChannel).toConstantValue(new MockOutputChannel('test'));
        container.bind(SwaTaskProvider).toConstantValue({} as SwaTaskProvider);
        container.bind(SwaDebugConfigurationProvider).toConstantValue({} as SwaDebugConfigurationProvider);
        container.bind(GitHubActionLogContentProvider).toConstantValue(contentProvider);
        container.bind(SwaTaskLifecycle).toConstantValue({ dispose: () => { /* noop */ } } as SwaTaskLifecycle);
        container.bind(ISwaCliService).toConstantValue({ warnIfOutdated: () => Promise.resolve() } as never);
        container.bind(IStaticWebAppsGitHubService).toConstantValue({ prepareAuthentication: () => Promise.resolve(false) } as never);

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
});
