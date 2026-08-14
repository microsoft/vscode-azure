/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource } from '@microsoft/vscode-azure-azutils';
import { ISettingsAdapter, type SettingsAdapter } from './SettingsAdapter';
import type { SettingsMap, SettingsSnapshot } from './core/SettingsModel';
import { injectable, multiInject, optional, type ServiceIdentifier } from 'inversify';

export const ISettingsRegistry: ServiceIdentifier<ISettingsRegistry> = Symbol.for('ISettingsRegistry');
export type ISettingsRegistry = SettingsRegistry;

/**
 * Dispatches settings operations to the {@linkcode SettingsAdapter} that owns a resource.
 *
 * Every settings surface -- tree, editor, and command -- goes through this type, so none of them
 * needs to know which products support settings. Adding a product is a matter of registering an
 * adapter; no shared code changes.
 *
 * @remarks
 * Adapter lookup is memoized by the resource's `logicalType`, because
 * {@linkcode SettingsRegistry.hasSettings hasSettings} is called for **every** resource the generic
 * data provider lists. Adapters must therefore decide `canHandle` from the logical type alone; an
 * adapter that also inspected, say, the resource's location would be memoized incorrectly.
 */
@injectable()
export class SettingsRegistry {
    /** Memoized `logicalType` (lowercased) -> adapter, or `null` for "no adapter handles this". */
    private readonly byLogicalType = new Map<string, SettingsAdapter | null>();

    public constructor(
        @multiInject(ISettingsAdapter) @optional() private readonly adapters: readonly SettingsAdapter[] = [],
    ) { }

    /** The adapter that owns {@linkcode resource}, or `undefined` if the product has no settings. */
    public getAdapter(resource: GenericResource): SettingsAdapter | undefined {
        const key = resource.logicalType.toLowerCase();

        let adapter = this.byLogicalType.get(key);
        if (adapter === undefined) {
            adapter = this.adapters.find(candidate => candidate.canHandle(resource)) ?? null;
            this.byLogicalType.set(key, adapter);
        }

        return adapter ?? undefined;
    }

    /** Whether {@linkcode resource} exposes settings. */
    public hasSettings(resource: GenericResource): boolean {
        return !!this.getAdapter(resource);
    }

    /**
     * Read a resource's current settings.
     *
     * @throws if no adapter handles the resource.
     */
    public async read(resource: GenericResource): Promise<SettingsSnapshot> {
        return await this.require(resource).read(resource);
    }

    /**
     * Replace a resource's settings in their entirety. Keys absent from {@linkcode entries} are
     * deleted.
     *
     * @throws if no adapter handles the resource, or the adapter rejects the write.
     */
    public async write(resource: GenericResource, entries: SettingsMap): Promise<void> {
        await this.require(resource).write(resource, entries);
    }

    private require(resource: GenericResource): SettingsAdapter {
        const adapter = this.getAdapter(resource);
        if (!adapter) {
            throw new Error(`No settings adapter is registered for resources of type '${resource.logicalType}'`);
        }

        return adapter;
    }
}
