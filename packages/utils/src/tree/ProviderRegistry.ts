/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../vscode/Disposable';
import { EventEmitter } from '../vscode/EventEmitter';
import type { DataProvider, DataProviderChangeEvent } from './DataProvider';

/**
 * Base class for trees that dispatch to multiple providers via `canHandle`.
 *
 * Manages provider registration/unregistration and fires a change event
 * when part of the tree has been invalidated.
 *
 * @typeParam TResource - The resource type used in the change event.
 * @typeParam TProvider - The provider interface (e.g. `DataProvider<T>` or `ViewProvider<T>`).
 */
export abstract class ProviderRegistry<TResource, TProvider extends DataProvider<TResource>> implements Disposable {
    protected readonly registrations: TProvider[] = [];
    protected readonly changeEmitter = new EventEmitter<TResource | undefined>();
    private readonly providerSubscriptions: Disposable[] = [];

    /**
     * Register a provider. Returns a {@linkcode Disposable} that
     * unregisters the provider when disposed.
     *
     * If the provider has an {@linkcode DataProvider.onDidChange} event,
     * the registry subscribes and calls {@linkcode onProviderChanged}
     * when it fires.
     *
     * **Registration order matters.** {@linkcode findProvider} returns the
     * first provider whose `canHandle` matches, so more-specific
     * providers must be registered before broader/fallback ones.
     */
    public registerProvider(provider: TProvider): Disposable {
        this.registrations.push(provider);

        const providerChangeSubscription = provider.onDidChange?.((event) => {
            this.onProviderChanged(event);
        });

        const registration = Disposable.from(
            {
                dispose: () => {
                    const idx = this.registrations.indexOf(provider);
                    if (idx !== -1) {
                        this.registrations.splice(idx, 1);
                    }
                    const subIdx = this.providerSubscriptions.indexOf(registration);
                    if (subIdx !== -1) {
                        this.providerSubscriptions.splice(subIdx, 1);
                    }
                }
            },
            providerChangeSubscription ?? Disposable.None,
        );

        this.providerSubscriptions.push(registration);
        return registration;
    }

    /**
     * Called when a registered provider fires its {@linkcode DataProvider.onDidChange} event.
     * Subclasses override this to handle the change (e.g. invalidate cache, refresh view).
     */
    protected abstract onProviderChanged(_event: DataProviderChangeEvent<TResource>): void;

    /**
     * Find the first registered provider that can handle the given resource.
     */
    protected findProvider(resource: unknown): TProvider | undefined {
        return this.registrations.find(r => r.canHandle(resource));
    }

    /**
     * Get all providers registered as root providers.
     */
    protected getRootProviders(): TProvider[] {
        return this.registrations.filter(r => r.isRoot);
    }

    /**
     * Dispose the change-notification emitter, all provider subscriptions,
     * and clear all registrations.
     */
    public dispose(): void {
        Disposable.disposeAll([...this.providerSubscriptions]);
        this.providerSubscriptions.length = 0;
        this.registrations.length = 0;
        this.changeEmitter.dispose();
    }
}
