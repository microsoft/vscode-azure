/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ISettingsAdapter,
    type GenericResource, type SettingsAdapter, type SettingsCollectionDescriptor,
} from '@microsoft/vscode-azure-azutils';
import type { SettingsEntry, SettingsMap, SettingsSnapshot } from '@microsoft/vscode-azure-utils';
import { injectable, multiInject, optional, type ServiceIdentifier } from 'inversify';

export const ISettingsRegistry: ServiceIdentifier<ISettingsRegistry> = Symbol.for('ISettingsRegistry');
export type ISettingsRegistry = SettingsRegistry;

/**
 * Dispatches settings operations to the {@linkcode SettingsAdapter} that owns a resource.
 *
 * Every settings surface -- tree, editor, and commands -- goes through this type, so none of them
 * needs to know which products support settings. Adding a product is a matter of registering an
 * adapter; no shared code changes.
 *
 * @remarks
 * Adapter lookup is memoized by the resource's `logicalType`, because
 * {@linkcode SettingsRegistry.getCollections getCollections} is called for **every** resource the
 * generic data provider lists. Adapters must therefore decide `canHandle` from the logical type
 * alone; an adapter that also inspected, say, the resource's location would be memoized
 * incorrectly.
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

    /** Whether {@linkcode resource} exposes any settings at all. */
    public hasSettings(resource: GenericResource): boolean {
        return this.getCollections(resource).length > 0;
    }

    /** Every settings collection on {@linkcode resource}, in display order. Empty if unsupported. */
    public getCollections(resource: GenericResource): readonly SettingsCollectionDescriptor[] {
        return this.getAdapter(resource)?.getCollections(resource) ?? [];
    }

    /** One collection by id, or `undefined` if the resource does not expose it. */
    public getCollection(resource: GenericResource, collectionId: string): SettingsCollectionDescriptor | undefined {
        return this.getCollections(resource).find(collection => collection.id === collectionId);
    }

    /**
     * Validate a proposed setting name, for live feedback in an input box.
     *
     * @returns a localized error message, or `undefined` if the name is acceptable or the adapter
     * has no opinion.
     */
    public validateKey(resource: GenericResource, collectionId: string, key: string): string | undefined {
        return this.getAdapter(resource)?.validateKey?.(resource, collectionId, key);
    }

    /**
     * Read a collection's current contents.
     *
     * @throws if no adapter handles the resource, or the collection id is unknown to it.
     */
    public async read(resource: GenericResource, collectionId: string): Promise<SettingsSnapshot> {
        return await this.require(resource, collectionId).read(resource, collectionId);
    }

    /**
     * Replace a collection's entire contents. Keys absent from {@linkcode entries} are deleted.
     *
     * @throws if no adapter handles the resource, or the adapter rejects the write.
     */
    public async write(resource: GenericResource, collectionId: string, entries: SettingsMap): Promise<void> {
        await this.require(resource, collectionId).write(resource, collectionId, entries);
    }

    /**
     * Add a setting, or replace the value of an existing one.
     *
     * Implemented as read-modify-write because the underlying services replace whole dictionaries
     * rather than patching keys. Like the editor, this is last-writer-wins over the keys it touches;
     * unlike the editor, it re-reads immediately beforehand, so keys it does *not* touch are
     * preserved.
     *
     * @throws if the adapter rejects the write.
     */
    public async upsert(resource: GenericResource, collectionId: string, entry: SettingsEntry): Promise<void> {
        const current = (await this.read(resource, collectionId)).entries;
        const existing = current.some(candidate => candidate.key === entry.key);

        const next = existing
            ? current.map(candidate => candidate.key === entry.key ? entry : candidate)
            : [...current, entry];

        await this.write(resource, collectionId, next);
    }

    /**
     * Delete a setting by key. Deleting a key that is already absent is a no-op.
     *
     * @throws if the adapter rejects the write.
     */
    public async remove(resource: GenericResource, collectionId: string, key: string): Promise<void> {
        const current = (await this.read(resource, collectionId)).entries;
        await this.write(resource, collectionId, current.filter(entry => entry.key !== key));
    }

    /**
     * Rename a setting, preserving its value, metadata, and position in the collection.
     *
     * @throws if the source key is missing, the target key already exists -- renaming onto an
     * existing key would silently destroy it -- or the adapter rejects the write.
     */
    public async rename(resource: GenericResource, collectionId: string, fromKey: string, toKey: string): Promise<void> {
        const current = (await this.read(resource, collectionId)).entries;
        if (!current.some(entry => entry.key === fromKey)) {
            throw new Error(`There is no setting named '${fromKey}' to rename.`);
        }
        if (current.some(entry => entry.key === toKey)) {
            throw new Error(`A setting named '${toKey}' already exists.`);
        }

        await this.write(
            resource,
            collectionId,
            current.map(entry => entry.key === fromKey ? { ...entry, key: toKey } : entry),
        );
    }

    private require(resource: GenericResource, collectionId: string): SettingsAdapter {
        const adapter = this.getAdapter(resource);
        if (!adapter) {
            throw new Error(`No settings adapter is registered for resources of type '${resource.logicalType}'`);
        }

        if (!adapter.getCollections(resource).some(collection => collection.id === collectionId)) {
            throw new Error(`'${resource.logicalType}' does not expose a settings collection named '${collectionId}'`);
        }

        return adapter;
    }
}
