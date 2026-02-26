/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from '../vscode/Disposable';
import { EventEmitter } from '../vscode/EventEmitter';
import type { DataProvider } from './DataProvider';

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

    /**
     * Register a provider. Returns a {@link Disposable} that
     * unregisters the provider when disposed.
     *
     * **Registration order matters.** {@link findProvider} returns the
     * first provider whose `canHandle` matches, so more-specific
     * providers must be registered before broader/fallback ones.
     */
    public registerProvider(provider: TProvider): Disposable {
        this.registrations.push(provider);
        return {
            dispose: () => {
                const idx = this.registrations.indexOf(provider);
                if (idx !== -1) {
                    this.registrations.splice(idx, 1);
                }
            },
        };
    }

    /**
     * Find the first registered provider that can handle the given resource.
     */
    protected findProvider(resource: unknown): TProvider | undefined {
        // TODO: for view providers, we are reparsing the AzureNodeId every call to `canHandle`...should improve that
        return this.registrations.find(r => r.canHandle(resource));
    }

    /**
     * Get all providers registered as root providers.
     */
    protected getRootProviders(): TProvider[] {
        return this.registrations.filter(r => r.isRoot);
    }

    /**
     * Dispose the change-notification emitter and clear all registrations.
     */
    public dispose(): void {
        this.registrations.length = 0;
        this.changeEmitter.dispose();
    }
}
