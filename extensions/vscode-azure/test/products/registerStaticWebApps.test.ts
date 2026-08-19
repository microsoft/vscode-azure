/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionExecutor, IExtensionContext, IVsCode } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { Container } from 'inversify';
import { mock } from 'node:test';
import { SwaDebugConfigurationProvider } from '../../src/debug/staticWebApps/SwaDebugConfigurationProvider';
import { registerStaticWebApps } from '../../src/products/registerStaticWebApps';
import { ProductRegistrar } from '../../src/registration/ProductRegistrar';
import { ISwaCliService } from '../../src/staticWebApps/SwaCliService';
import { SwaTaskLifecycle } from '../../src/tasks/staticWebApps/SwaTaskLifecycle';
import { SwaTaskProvider } from '../../src/tasks/staticWebApps/SwaTaskProvider';

describe('registerStaticWebApps (unit)', () => {
    function setup() {
        const mockResult = createMockVsCode();
        const subscriptions: { dispose(): void }[] = [];
        const container = new Container();
        const warnIfOutdated = mock.fn(() => Promise.resolve());
        let lifecycleResolved = false;

        container.bind(IVsCode).toConstantValue(mockResult.vscode);
        container.bind(IExtensionContext).toConstantValue({ subscriptions } as never);
        container.bind(IActionExecutor).toConstantValue(createTestActionExecutor().executor);
        container.bind(SwaTaskProvider).toConstantValue({} as SwaTaskProvider);
        container.bind(SwaDebugConfigurationProvider).toConstantValue({} as SwaDebugConfigurationProvider);
        container.bind(SwaTaskLifecycle).toDynamicValue(() => {
            lifecycleResolved = true;
            return { dispose: () => { /* noop */ } } as SwaTaskLifecycle;
        }).inSingletonScope();
        container.bind(ISwaCliService).toConstantValue({ warnIfOutdated } as never);

        const activate = () => {
            const registrar = new ProductRegistrar();
            registerStaticWebApps(registrar);
            registrar.activate(container);
        };

        return { mockResult, subscriptions, container, warnIfOutdated, activate, isLifecycleResolved: () => lifecycleResolved };
    }

    it('should register task, debug, and lifecycle services on activation', () => {
        const { mockResult, subscriptions, activate, isLifecycleResolved } = setup();

        activate();

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
        expect(subscriptions).to.have.lengthOf(4);
        expect(isLifecycleResolved()).to.equal(true);
    });

    it('should skip the CLI update check when no workspace folder holds a static web app', async () => {
        const { mockResult, warnIfOutdated, activate } = setup();
        mockResult.workspaceFolders.push(
            { uri: mockResult.vscode.Uri.file('/workspace'), name: 'workspace', index: 0 },
        );

        activate();
        await Promise.resolve();
        await Promise.resolve();

        expect(warnIfOutdated.mock.callCount()).to.equal(0);
    });

    it('should run the CLI update check when a workspace folder holds a static web app', async () => {
        const { mockResult, warnIfOutdated, activate } = setup();
        const folder = mockResult.vscode.Uri.file('/workspace');
        mockResult.workspaceFolders.push({ uri: folder, name: 'workspace', index: 0 });
        mockResult.fs.addFile(mockResult.vscode.Uri.joinPath(folder, 'swa-cli.config.json'));

        activate();
        await waitForCallCount(warnIfOutdated);

        expect(warnIfOutdated.mock.callCount()).to.equal(1);
    });
});

async function waitForCallCount(fn: { mock: { callCount(): number } }): Promise<void> {
    for (let attempt = 0; attempt < 100 && fn.mock.callCount() === 0; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}
