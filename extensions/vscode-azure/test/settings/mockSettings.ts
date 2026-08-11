/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    GenericResource, SettingsAdapter, SettingsCollectionDescriptor,
} from '@microsoft/vscode-azure-azutils';
import { createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import type { SettingsEntry, SettingsMap, SettingsSnapshot } from '@microsoft/vscode-azure-utils';
import { SettingsRegistry } from '../../src/settings/SettingsRegistry';
import { SettingsDataProvider } from '../../src/tree/resources/settings/SettingsDataProvider';

/** Options for {@linkcode createStubAdapter}. */
export interface StubAdapterOptions {
    /** Logical types the adapter claims. Compared case-insensitively. */
    readonly logicalTypes: readonly string[];
    /** Collections the adapter exposes. Defaults to a single unstructured `appSettings`. */
    readonly collections?: readonly SettingsCollectionDescriptor[];
    /** Collection ids the adapter refuses to write. Defaults to none. */
    readonly readOnlyCollections?: readonly string[];
    /** Seed contents per collection id. Defaults to empty. */
    readonly entries?: Readonly<Record<string, SettingsMap>>;
}

/**
 * An in-memory {@linkcode SettingsAdapter} for tests.
 *
 * Writes are retained, so a test can assert round-trip behaviour without mocking a service. Use
 * {@linkcode StubAdapter.writes} to assert exactly what the framework sent.
 */
export class StubAdapter implements SettingsAdapter {
    /** Every `write` call, in order, as `[collectionId, entries]`. */
    public readonly writes: [string, SettingsMap][] = [];

    private readonly store = new Map<string, SettingsMap>();
    private readonly logicalTypes: Set<string>;
    private readonly collections: readonly SettingsCollectionDescriptor[];

    public constructor(private readonly options: StubAdapterOptions) {
        this.logicalTypes = new Set(options.logicalTypes.map(type => type.toLowerCase()));
        this.collections = options.collections ?? [{ id: 'appSettings', label: 'Application Settings', structured: false }];

        for (const [collectionId, entries] of Object.entries(options.entries ?? {})) {
            this.store.set(collectionId, entries);
        }
    }

    /** @inheritdoc */
    public canHandle(resource: GenericResource): boolean {
        return this.logicalTypes.has(resource.logicalType.toLowerCase());
    }

    /** @inheritdoc */
    public getCollections(resource: GenericResource): readonly SettingsCollectionDescriptor[] {
        return this.canHandle(resource) ? this.collections : [];
    }

    /** @inheritdoc */
    public read(resource: GenericResource, collectionId: string): Promise<SettingsSnapshot> {
        const collection = this.collections.find(candidate => candidate.id === collectionId);
        if (!collection) {
            return Promise.reject(new Error(`Unknown collection '${collectionId}'`));
        }

        return Promise.resolve({
            entries: this.store.get(collectionId) ?? [],
            resourceName: resource.name,
            collectionLabel: collection.label,
            writable: !this.isReadOnly(collectionId),
            structured: collection.structured,
        });
    }

    /** @inheritdoc */
    public write(_resource: GenericResource, collectionId: string, entries: SettingsMap): Promise<void> {
        if (this.isReadOnly(collectionId)) {
            return Promise.reject(new Error(`Settings in '${collectionId}' are read-only.`));
        }

        this.writes.push([collectionId, entries]);
        this.store.set(collectionId, entries);
        return Promise.resolve();
    }

    private isReadOnly(collectionId: string): boolean {
        return this.options.readOnlyCollections?.includes(collectionId) ?? false;
    }

    /** Current contents of a collection, as the stub sees them. */
    public contents(collectionId: string): SettingsMap {
        return this.store.get(collectionId) ?? [];
    }
}

/** Build a {@linkcode StubAdapter}. */
export function createStubAdapter(options: StubAdapterOptions): StubAdapter {
    return new StubAdapter(options);
}

/** A {@linkcode SettingsRegistry} over the given adapters (none by default). */
export function createSettingsRegistry(...adapters: SettingsAdapter[]): SettingsRegistry {
    return new SettingsRegistry(adapters);
}

/**
 * A {@linkcode SettingsDataProvider} over the given adapters.
 *
 * With no adapters it reports no settings for every resource, which is what tests of unrelated
 * providers want.
 */
export function createSettingsDataProvider(...adapters: SettingsAdapter[]): SettingsDataProvider {
    const { executor } = createTestActionExecutor();
    return new SettingsDataProvider(executor, createSettingsRegistry(...adapters));
}

/** Shorthand for building a {@linkcode SettingsEntry}. */
export function entry(key: string, value: string, metadata?: Record<string, string>): SettingsEntry {
    return metadata ? { key, value, metadata } : { key, value };
}
