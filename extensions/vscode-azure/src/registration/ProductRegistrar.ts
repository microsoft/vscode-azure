/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription, ConcreteAzureNode, ICredentialFactory, TokenCredential } from '@microsoft/vscode-azure-azutils';
import { ICredentialFactory as ICredentialFactoryId } from '@microsoft/vscode-azure-azutils';
import type { DataProvider, IActionExecutor, ICodeContext, ViewProvider } from '@microsoft/vscode-azure-utils';
import { IActionExecutor as IActionExecutorId, ICodeContext as ICodeContextId } from '@microsoft/vscode-azure-utils';
import type { Container, Newable, ServiceIdentifier } from 'inversify';
import type { ManagedCommand } from '../commands/ManagedCommand';

/** A constructor for a command resolved in a command-scoped DI container. */
export type ManagedCommandConstructor = new (...ctorArgs: any[]) => ManagedCommand; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Declarative registration for one managed command and its fixed leading arguments. */
export interface ManagedCommandRegistration {
    readonly commandId: string;
    readonly commandClass: ManagedCommandConstructor;
    readonly prefixArgs: readonly unknown[];
}

/**
 * A provider contribution that is either bound directly to a collection or
 * exposed as a singleton under a primary identifier and aliased into it.
 */
export type ProviderEntry<T> = Newable<T> | readonly [ServiceIdentifier<T>, Newable<T>];

/** Callback that adds product-owned bindings to the root container. */
export type ProductBinding = (container: Container) => void;

/** Product-owned activation work run inside the extension activation boundary. */
export type ProductActivation = (container: Container) => void | Promise<void>;

/**
 * Collects all wiring contributed by a product before the root container is
 * built, allowing test overrides to run before commands, trees, or hooks are activated.
 */
export class ProductRegistrar {
    private readonly bindings: ProductBinding[] = [];
    private readonly managedCommands: ManagedCommandRegistration[] = [];
    private readonly resourceDataProviders: ProviderEntry<DataProvider<ConcreteAzureNode>>[] = [];
    private readonly resourceViewProviders: ProviderEntry<ViewProvider<string>>[] = [];
    private readonly activationHooks: ProductActivation[] = [];

    /** Add arbitrary product-owned DI bindings. */
    public registerBinding(binding: ProductBinding): void {
        this.bindings.push(binding);
    }

    /** Add a managed command without resolving its class during registration. */
    public registerCommand(
        commandId: string,
        commandClass: ManagedCommandConstructor,
        ...prefixArgs: unknown[]
    ): void {
        this.managedCommands.push({ commandId, commandClass, prefixArgs });
    }

    /** Add a product-specific Azure resource data provider. */
    public registerResourceDataProvider(provider: ProviderEntry<DataProvider<ConcreteAzureNode>>): void {
        this.resourceDataProviders.push(provider);
    }

    /** Add a product-specific Azure resource view provider. */
    public registerResourceViewProvider(provider: ProviderEntry<ViewProvider<string>>): void {
        this.resourceViewProviders.push(provider);
    }

    /** Add product-owned work that must run when the extension activates. */
    public registerActivationHook(hook: ProductActivation): void {
        this.activationHooks.push(hook);
    }

    /**
     * Add the standard subscription-scoped Azure client provider binding.
     *
     * The client factory receives the shared action/code contexts, a credential
     * scoped to the requested subscription, and the subscription itself.
     */
    public registerAzureClientProvider<TResult>(
        providerId: ServiceIdentifier<(subscription: AzureSubscription) => TResult>,
        create: AzureClientCreate<TResult>,
    ): void {
        this.registerBinding(container => {
            bindAzureClientProvider(container, providerId, create);
        });
    }

    /** Apply product bindings before callers install mock/test overrides. */
    public applyBindings(container: Container): void {
        for (const binding of this.bindings) {
            binding(container);
        }
    }

    /** Return managed command contributions in product registration order. */
    public getCommands(): readonly ManagedCommandRegistration[] {
        return this.managedCommands;
    }

    /** Return Azure resource data providers in dispatch order. */
    public getResourceDataProviders(): readonly ProviderEntry<DataProvider<ConcreteAzureNode>>[] {
        return this.resourceDataProviders;
    }

    /** Return Azure resource view providers in dispatch order. */
    public getResourceViewProviders(): readonly ProviderEntry<ViewProvider<string>>[] {
        return this.resourceViewProviders;
    }

    /** Run product activation hooks sequentially in registration order. */
    public async activate(container: Container): Promise<void> {
        for (const hook of this.activationHooks) {
            await hook(container);
        }
    }
}

/** Signature shared by subscription-scoped Azure REST client `create` methods. */
export type AzureClientCreate<TResult> = (
    context: ICodeContext,
    executor: IActionExecutor,
    credential: TokenCredential,
    subscription: AzureSubscription,
) => TResult;

/**
 * Bind a subscription-scoped Azure client provider with the extension's common
 * context, executor, and credential dependencies.
 */
export function bindAzureClientProvider<TResult>(
    container: Container,
    providerId: ServiceIdentifier<(subscription: AzureSubscription) => TResult>,
    create: AzureClientCreate<TResult>,
): void {
    container.bind(providerId).toFactory(context => {
        const codeContext = context.get(ICodeContextId);
        const executor = context.get(IActionExecutorId);
        const credentialFactory: ICredentialFactory = context.get(ICredentialFactoryId);
        return (subscription: AzureSubscription) => create(
            codeContext,
            executor,
            credentialFactory(subscription),
            subscription,
        );
    });
}
