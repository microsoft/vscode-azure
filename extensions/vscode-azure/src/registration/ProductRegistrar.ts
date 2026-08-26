/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscriptionTarget, ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import type { DataProvider, ViewProvider } from '@microsoft/vscode-azure-utils';
import type { Container, ServiceIdentifier } from 'inversify';
import type { ManagedCommand } from '../commands/ManagedCommand';
import { bindAzureClientProvider, bindDataPlaneClientProvider, type AzureClientCreate, type DataPlaneClientCreate, type ProviderEntry } from '../services';

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

/** Callback that activates a product contribution after commands and trees are registered. */
export type ProductActivation = (container: Container) => void;

/**
 * Collects all wiring contributed by a product before the root container is
 * built, allowing test overrides to run before commands or trees are activated.
 */
export class ProductRegistrar {
    private readonly bindings: ProductBinding[] = [];
    private readonly activations: ProductActivation[] = [];
    private readonly managedCommands: ManagedCommandRegistration[] = [];
    private readonly resourceDataProviders: ProviderEntry<DataProvider<ConcreteAzureNode>>[] = [];
    private readonly resourceViewProviders: ProviderEntry<ViewProvider<string>>[] = [];

    /** Add arbitrary product-owned DI bindings. */
    public registerBinding(binding: ProductBinding): void {
        this.bindings.push(binding);
    }

    /** Add product-owned activation work that depends on the fully registered resource tree. */
    public registerActivation(activation: ProductActivation): void {
        this.activations.push(activation);
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
     * scoped to the requested subscription, and the subscription itself -- in
     * whatever shape that provider's identifier declares (see
     * {@linkcode AzureClientCreate}).
     */
    public registerAzureClientProvider<TResult, TSubscription extends AzureSubscriptionTarget>(
        providerId: ServiceIdentifier<(subscription: TSubscription) => TResult>,
        create: AzureClientCreate<TResult, TSubscription>,
    ): void {
        this.registerBinding(container => {
            bindAzureClientProvider(container, providerId, create);
        });
    }

    /**
     * Add the standard subscription-scoped data-plane client provider binding.
     *
     * Use this for a client that addresses a service's own endpoint rather than
     * ARM. The client factory receives a credential scoped to the requested
     * subscription, the subscription (whose environment names the endpoint's
     * cloud), and any further arguments that provider's identifier declares --
     * a registry login server, for instance (see
     * {@linkcode DataPlaneClientCreate}).
     */
    public registerDataPlaneClientProvider<TResult, TSubscription extends AzureSubscriptionTarget, TArgs extends unknown[]>(
        providerId: ServiceIdentifier<(subscription: TSubscription, ...args: TArgs) => TResult>,
        create: DataPlaneClientCreate<TResult, TSubscription, TArgs>,
    ): void {
        this.registerBinding(container => {
            bindDataPlaneClientProvider(container, providerId, create);
        });
    }

    /** Apply product bindings before callers install mock/test overrides. */
    public applyBindings(container: Container): void {
        for (const binding of this.bindings) {
            binding(container);
        }
    }

    /** Activate product contributions after commands and trees have been registered. */
    public activate(container: Container): void {
        for (const activation of this.activations) {
            activation(container);
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
