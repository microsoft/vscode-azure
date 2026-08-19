/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FunctionAppLogicalType, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import type { SettingsAdapter } from '../../src/settings/SettingsAdapter';
import type { SettingsMap, SettingsSnapshot } from '../../src/settings/SettingsModel';
import { getSettingsNodes, type SettingsNode } from '../../src/tree/resources/settings/SettingsNode';

/** Options for {@linkcode StubAdapter}. */
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

/**
 * A `Microsoft.Web/sites` resource, the shape every settings test needs.
 *
 * Defaults to a Function App, since that is the only product with an adapter today. Pass
 * `logicalType` to exercise dispatch, or any other field to vary the ARM id or name.
 */
export function makeSettingsResource(overrides?: Parameters<typeof makeGenericResource>[0]): GenericResource {
    return makeGenericResource({
        id: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/MyRG/providers/Microsoft.Web/sites/MyFuncApp',
        name: 'MyFuncApp',
        type: 'Microsoft.Web/sites',
        logicalType: FunctionAppLogicalType,
        ...overrides,
    });
}

/** Build the standard settings virtual-node fixture. */
export function makeSettingsNode(
    overrides?: Parameters<typeof makeGenericResource>[0],
    adapter: SettingsAdapter = new StubAdapter({ logicalTypes: [FunctionAppLogicalType] }),
): SettingsNode {
    return getSettingsNodes(makeSettingsResource(overrides), adapter)[0];
}

/** A settings snapshot with sensible defaults for editor and format tests. */
export function makeSettingsSnapshot(overrides?: Partial<SettingsSnapshot>): SettingsSnapshot {
    return {
        entries: [],
        resourceName: 'MyFuncApp',
        label: 'Application Settings',
        writable: true,
        ...overrides,
    };
}
