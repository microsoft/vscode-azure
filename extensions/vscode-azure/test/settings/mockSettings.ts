/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource } from '@microsoft/vscode-azure-azutils';
import type { SettingsAdapter } from '../../src/settings/SettingsAdapter';
import type { SettingsEntry, SettingsMap, SettingsSnapshot } from '../../src/settings/core/SettingsModel';
import { SettingsRegistry } from '../../src/settings/SettingsRegistry';
import { SettingsDataProvider } from '../../src/tree/resources/settings/SettingsDataProvider';

/** Options for {@linkcode createStubAdapter}. */
export interface StubAdapterOptions {
    /** Logical types the adapter claims. Compared case-insensitively. */
    readonly logicalTypes: readonly string[];
    /** Display name the adapter reports. Defaults to `Application Settings`. */
    readonly label?: string;
    /** When true, the adapter refuses writes and reports itself read-only. Defaults to false. */
    readonly readOnly?: boolean;
    /** Seed contents. Defaults to empty. */
    readonly entries?: SettingsMap;
}

/**
 * An in-memory {@linkcode SettingsAdapter} for tests.
 *
 * Writes are retained, so a test can assert round-trip behaviour without mocking a service. Use
 * {@linkcode StubAdapter.writes} to assert exactly what the framework sent.
 */
export class StubAdapter implements SettingsAdapter {
    /** Every `write` call, in order. */
    public readonly writes: SettingsMap[] = [];

    /** @inheritdoc */
    public readonly label: string;

    private entries: SettingsMap;
    private readonly logicalTypes: Set<string>;

    public constructor(private readonly options: StubAdapterOptions) {
        this.logicalTypes = new Set(options.logicalTypes.map(type => type.toLowerCase()));
        this.label = options.label ?? 'Application Settings';
        this.entries = options.entries ?? [];
    }

    /** @inheritdoc */
    public canHandle(resource: GenericResource): boolean {
        return this.logicalTypes.has(resource.logicalType.toLowerCase());
    }

    /** @inheritdoc */
    public read(resource: GenericResource): Promise<SettingsSnapshot> {
        return Promise.resolve({
            entries: this.entries,
            resourceName: resource.name,
            label: this.label,
            writable: !this.options.readOnly,
        });
    }

    /** @inheritdoc */
    public write(_resource: GenericResource, entries: SettingsMap): Promise<void> {
        if (this.options.readOnly) {
            return Promise.reject(new Error('These settings are read-only.'));
        }

        this.writes.push(entries);
        this.entries = entries;
        return Promise.resolve();
    }

    /** Current contents, as the stub sees them. */
    public contents(): SettingsMap {
        return this.entries;
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
    return new SettingsDataProvider(createSettingsRegistry(...adapters));
}

/** Shorthand for building a {@linkcode SettingsEntry}. */
export function entry(key: string, value: string): SettingsEntry {
    return { key, value };
}
