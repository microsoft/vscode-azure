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
    type ActionCallback,
    IActionExecutor,
    type IActionContext,
    ICodeContext,
    ICommandRegistry,
    type ICommandRegistry as ICommandRegistryType,
} from '@microsoft/vscode-azure-utils';
import { expect } from 'chai';
import { Container, injectable, type ServiceIdentifier } from 'inversify';
import { mock } from 'node:test';
import { registerCommands } from '../../src/commands/registerCommands';
import type { ManagedCommand } from '../../src/commands/ManagedCommand';
import { registerProducts } from '../../src/products/registerProducts';
import {
    bindAzureClientProvider,
    ProductRegistrar,
} from '../../src/registration/ProductRegistrar';
import { AcrDataProvider } from '../../src/tree/resources/acr/AcrDataProvider';
import { AcrViewProvider } from '../../src/tree/resources/acr/AcrViewProvider';
import {
    FunctionAppDataProvider,
    IFunctionAppDataProvider,
} from '../../src/tree/resources/functions/FunctionAppDataProvider';
import { FunctionAppViewProvider } from '../../src/tree/resources/functions/FunctionAppViewProvider';
import { bindProviders } from '../../src/tree/registerTrees';

class TestCommandRegistry implements ICommandRegistryType {
    public readonly callbacks = new Map<string, ActionCallback<unknown>>();

    public registerCommand<T = unknown>(commandId: string, callback: ActionCallback<T>): void {
        this.callbacks.set(commandId, callback);
    }

    public dispose(): void {
        this.callbacks.clear();
    }
}

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
        expect(dataProviders[0]).to.equal(AcrDataProvider);
        expect(dataProviders[1]).to.deep.equal([IFunctionAppDataProvider, FunctionAppDataProvider]);
        expect(viewProviders).to.deep.equal([AcrViewProvider, FunctionAppViewProvider]);
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
        const registry = new TestCommandRegistry();
        const container = new Container();
        container.bind(ICommandRegistry).toConstantValue(registry);
        registrar.registerCommand('test.command', TestCommand, 'fixed');

        registerCommands(container, registrar.getCommands());
        const callback = registry.callbacks.get('test.command');
        expect(callback).to.not.equal(undefined);

        await callback?.({} as IActionContext, 'runtime');

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

    it('runs activation hooks after bindings can be overridden', async () => {
        const registrar = new ProductRegistrar();
        const container = new Container();
        const serviceId: ServiceIdentifier<string> = Symbol('ITestService');
        const activatedValues: string[] = [];
        registrar.registerBinding(current => current.bind(serviceId).toConstantValue('original'));
        registrar.registerActivationHook(current => {
            activatedValues.push(current.get(serviceId));
        });

        registrar.applyBindings(container);
        container.unbind(serviceId);
        container.bind(serviceId).toConstantValue('override');
        expect(activatedValues).to.be.empty;

        await registrar.activate(container);

        expect(activatedValues).to.deep.equal(['override']);
    });
});
