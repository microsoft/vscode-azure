/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription, ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import type { DataProvider, ViewProvider } from '@microsoft/vscode-azure-utils';
import type { Container, ServiceIdentifier } from 'inversify';
import type { ManagedCommand } from '../commands/ManagedCommand';
import { bindAzureClientProvider, type AzureClientCreate, type ProviderEntry } from '../services';

/** A constructor for a command resolved in a command-scoped DI container. */
export type ManagedCommandConstructor = new (...ctorArgs: any[]) => ManagedCommand; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Declarative registration for one managed command and its fixed leading arguments. */
export interface ManagedCommandRegistration {
    readonly commandId: string;
    readonly commandClass: ManagedCommandConstructor;
    readonly prefixArgs: readonly unknown[];
}

/** Callback that adds product-owned bindings to the root container. */
export type ProductBinding = (container: Container) => void;

/**
 * Collects all wiring contributed by a product before the root container is
 * built, allowing test overrides to run before commands or trees are activated.
 */
export class ProductRegistrar {
    private readonly bindings: ProductBinding[] = [];
    private readonly managedCommands: ManagedCommandRegistration[] = [];
    private readonly resourceDataProviders: ProviderEntry<DataProvider<ConcreteAzureNode>>[] = [];
    private readonly resourceViewProviders: ProviderEntry<ViewProvider<string>>[] = [];

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

}
