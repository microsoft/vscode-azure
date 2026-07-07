/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CredentialFactoryOptions } from '@microsoft/vscode-azure-azutils';
import { injectable, type ServiceIdentifier } from 'inversify';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Ambient scope carrying {@linkcode CredentialFactoryOptions} that the default
 * {@linkcode ICredentialFactory} merges beneath each per-request input.
 *
 * This is the seam that lets a caller influence credentials built by a
 * long-lived singleton (the resource tree provider) without threading options
 * through the generic tree layer: the caller opens a scope via {@linkcode run},
 * and the credential factory reads {@linkcode current} at the moment it builds
 * each credential. Because the tree provider captures its factory once at
 * construction, an ambient value read *inside the factory closure* is the only
 * way to reach it at call time.
 */
export interface ICredentialOptionsScope {
    /**
     * Run `fn` with `options` as the ambient credential defaults. The value is
     * visible to any credential built (synchronously or across `await`s) within
     * `fn`'s async execution, and is restored to the previous value once `fn`
     * settles. Nested scopes replace the ambient value for their duration.
     */
    run<T>(options: CredentialFactoryOptions, fn: () => T): T;

    /** The ambient credential options for the current async flow, if any. */
    readonly current: CredentialFactoryOptions | undefined;
}

/** DI identifier for the {@linkcode ICredentialOptionsScope}. */
export const ICredentialOptionsScope: ServiceIdentifier<ICredentialOptionsScope> = Symbol.for('ICredentialOptionsScope');

/**
 * {@linkcode AsyncLocalStorage}-backed implementation of
 * {@linkcode ICredentialOptionsScope}. Bound as a singleton so the credential
 * factory and every command share one store; the storage itself keeps each
 * concurrent async flow isolated.
 */
@injectable()
export class CredentialOptionsScope implements ICredentialOptionsScope {
    private readonly storage = new AsyncLocalStorage<CredentialFactoryOptions>();

    public run<T>(options: CredentialFactoryOptions, fn: () => T): T {
        return this.storage.run(options, fn);
    }

    public get current(): CredentialFactoryOptions | undefined {
        return this.storage.getStore();
    }
}
