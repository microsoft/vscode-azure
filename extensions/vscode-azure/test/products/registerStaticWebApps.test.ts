/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionContext, IVsCode } from '@microsoft/vscode-azure-utils';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { Container } from 'inversify';
import { SwaDebugConfigurationProvider } from '../../src/debug/staticWebApps/SwaDebugConfigurationProvider';
import { registerStaticWebApps } from '../../src/products/registerStaticWebApps';
import { ProductRegistrar } from '../../src/registration/ProductRegistrar';
import { ISwaCliService } from '../../src/staticWebApps/SwaCliService';
import { SwaTaskLifecycle } from '../../src/tasks/staticWebApps/SwaTaskLifecycle';
import { SwaTaskProvider } from '../../src/tasks/staticWebApps/SwaTaskProvider';

describe('registerStaticWebApps (unit)', () => {
    it('should register task, debug, and lifecycle services on activation', () => {
        const mockResult = createMockVsCode();
        const subscriptions: { dispose(): void }[] = [];
        const container = new Container();
        let lifecycleResolved = false;

        container.bind(IVsCode).toConstantValue(mockResult.vscode);
        container.bind(IExtensionContext).toConstantValue({ subscriptions } as never);
        container.bind(SwaTaskProvider).toConstantValue({} as SwaTaskProvider);
        container.bind(SwaDebugConfigurationProvider).toConstantValue({} as SwaDebugConfigurationProvider);
        container.bind(SwaTaskLifecycle).toDynamicValue(() => {
            lifecycleResolved = true;
            return { dispose: () => { /* noop */ } } as SwaTaskLifecycle;
        }).inSingletonScope();
        container.bind(ISwaCliService).toConstantValue({ warnIfOutdated: () => Promise.resolve() } as never);

        const registrar = new ProductRegistrar();
        registerStaticWebApps(registrar);
        registrar.applyActivations(container);

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
        expect(lifecycleResolved).to.equal(true);
    });
});
