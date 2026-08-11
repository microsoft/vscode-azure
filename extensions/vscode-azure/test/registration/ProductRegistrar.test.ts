/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type AzureSubscription,
    type CredentialFactoryInput,
    ICredentialFactory,
    type TokenCredential,
} from '@microsoft/vscode-azure-azutils';
import { makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import {
    CommandRegistry,
    IActionExecutor,
    ICodeContext,
    ICommandRegistry,
} from '@microsoft/vscode-azure-utils';
import { createMockVsCode, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { Container, injectable, type ServiceIdentifier } from 'inversify';
import { mock } from 'node:test';
import { registerCommands } from '../../src/commands/registerCommands';
import type { ManagedCommand } from '../../src/commands/ManagedCommand';
import { registerProducts } from '../../src/products/registerProducts';
import { ProductRegistrar } from '../../src/registration/ProductRegistrar';
import { bindAzureClientProvider, bindProviders } from '../../src/services';
import { AcrDataProvider } from '../../src/tree/resources/acr/AcrDataProvider';
import { AcrViewProvider } from '../../src/tree/resources/acr/AcrViewProvider';
import { AzureAccountDataProvider, IAzureAccountDataProvider } from '../../src/tree/resources/AzureAccountDataProvider';
import { AzureResourceDataProvider } from '../../src/tree/resources/AzureResourceDataProvider';
import { GenericAzureViewProvider } from '../../src/tree/resources/GenericAzureViewProvider';
import { ISettingsDataProvider, SettingsDataProvider } from '../../src/tree/resources/settings/SettingsDataProvider';
import { SettingsViewProvider } from '../../src/tree/resources/settings/SettingsViewProvider';

@injectable()
class TestCommand implements ManagedCommand {
    public static readonly calls: unknown[][] = [];

    public execute(...args: unknown[]): void {
        TestCommand.calls.push(args);
    }
}

describe('ProductRegistrar (unit)', () => {
    afterEach(() => {
        TestCommand.calls.length = 0;
        mock.restoreAll();
    });

    it('collects product resource providers in dispatch order', () => {
        const registrar = new ProductRegistrar();

        registerProducts(registrar);

        const dataProviders = registrar.getResourceDataProviders();
        const viewProviders = registrar.getResourceViewProviders();
        const commandIds = registrar.getCommands().map(command => command.commandId);
        expect(dataProviders[0]).to.equal(AcrDataProvider);
        expect(dataProviders[1]).to.deep.equal([ISettingsDataProvider, SettingsDataProvider]);
        expect(dataProviders[2]).to.deep.equal([IAzureAccountDataProvider, AzureAccountDataProvider]);
        expect(dataProviders[3]).to.equal(AzureResourceDataProvider);
        expect(viewProviders).to.deep.equal([AcrViewProvider, SettingsViewProvider, GenericAzureViewProvider]);
        expect(commandIds).to.include.members([
            'vscode-azure/resources/refresh',
            'vscode-azure/resources/groupBy',
            'vscode-azure/resources/openInPortal',
            'vscode-azure/signIn',
            'vscode-azure/selectSubscriptions',
        ]);
    });

    it('binds primary provider identifiers as singleton collection aliases', () => {
        interface Provider {
            readonly name: string;
        }

        @injectable()
        class DirectProvider implements Provider {
            public readonly name = 'direct';
        }

        @injectable()
        class AliasedProvider implements Provider {
            public readonly name = 'aliased';
        }

        const collectionId: ServiceIdentifier<Provider> = Symbol('IProviders');
        const primaryId: ServiceIdentifier<Provider> = Symbol('IAliasedProvider');
        const container = new Container();

        bindProviders<Provider>(container, collectionId, [DirectProvider, [primaryId, AliasedProvider]]);

        const providers = container.getAll<Provider>(collectionId);
        expect(providers.map(provider => provider.name)).to.deep.equal(['direct', 'aliased']);
        expect(providers[1]).to.equal(container.get(primaryId));
    });

    it('preserves command prefix arguments when registered commands execute', async () => {
        const registrar = new ProductRegistrar();
        const { executor } = createTestActionExecutor();
        const { vscode: code, registeredCommands } = createMockVsCode();
        const registry = new CommandRegistry(executor, code);
        const container = new Container();
        container.bind(ICommandRegistry).toConstantValue(registry);
        registrar.registerCommand('test.command', TestCommand, 'fixed');

        registerCommands(container, registrar.getCommands());
        const callback = registeredCommands.get('test.command');
        expect(callback).to.not.equal(undefined);

        await callback?.('runtime');

        expect(TestCommand.calls).to.deep.equal([['fixed', 'runtime']]);
    });

    it('resolves common Azure client dependencies for each subscription', () => {
        interface ClientResult {
            readonly subscriptionId: string;
        }

        const providerId: ServiceIdentifier<(subscription: AzureSubscription) => ClientResult> =
            Symbol('ITestClientProvider');
        const container = new Container();
        const codeContext = {} as ICodeContext;
        const executor = {} as IActionExecutor;
        const credential: TokenCredential = {
            getToken: mock.fn(() => Promise.resolve(null)),
        };
        const credentialFactory = mock.fn((_input?: CredentialFactoryInput) => credential);
        const create = mock.fn((
            actualCodeContext: ICodeContext,
            actualExecutor: IActionExecutor,
            actualCredential: TokenCredential,
            subscription: AzureSubscription,
        ): ClientResult => {
            expect(actualCodeContext).to.equal(codeContext);
            expect(actualExecutor).to.equal(executor);
            expect(actualCredential).to.equal(credential);
            return { subscriptionId: subscription.subscriptionId };
        });
        container.bind(ICodeContext).toConstantValue(codeContext);
        container.bind(IActionExecutor).toConstantValue(executor);
        container.bind(ICredentialFactory).toConstantValue(credentialFactory);
        bindAzureClientProvider(container, providerId, create);
        const subscription = makeSubscription({ subscriptionId: 'subscription-id' });

        const provider = container.get<(subscription: AzureSubscription) => ClientResult>(providerId);
        const result = provider(subscription);

        expect(result.subscriptionId).to.equal(subscription.subscriptionId);
        expect(credentialFactory.mock.calls[0].arguments[0]).to.equal(subscription);
        expect(create.mock.callCount()).to.equal(1);
    });

    it('does not replace a shared Azure client provider binding', () => {
        interface ClientResult {
            readonly source: string;
        }

        const registrar = new ProductRegistrar();
        const container = new Container();
        const providerId: ServiceIdentifier<(subscription: AzureSubscription) => ClientResult> =
            Symbol('ISharedClientProvider');
        const codeContext = {} as ICodeContext;
        const executor = {} as IActionExecutor;
        const credential: TokenCredential = { getToken: mock.fn(() => Promise.resolve(null)) };
        container.bind(ICodeContext).toConstantValue(codeContext);
        container.bind(IActionExecutor).toConstantValue(executor);
        container.bind(ICredentialFactory).toConstantValue(() => credential);
        registrar.registerAzureClientProvider(providerId, () => {
            return { source: 'first' };
        });
        registrar.registerAzureClientProvider(providerId, () => {
            return { source: 'second' };
        });

        registrar.applyBindings(container);
        const provider = container.get<(subscription: AzureSubscription) => ClientResult>(providerId);

        expect(provider(makeSubscription()).source).to.equal('first');
    });
});
