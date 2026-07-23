/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Minimal client contract shared by resource-specific app-settings adapters.
 */
export interface IAppSettingsClient {
    /** Reads all current settings. */
    list(): Promise<Record<string, string>>;
    /** Replaces all current settings and returns the persisted values. */
    update(settings: Record<string, string>): Promise<Record<string, string>>;
}

/**
 * Reusable app-settings cache and mutation model.
 *
 * Resource providers supply a stable parent key and a resource-specific client
 * adapter. Mutations always read the latest remote values before replacing the
 * settings collection, then refresh the local cache used by edit commands.
 */
export class AppSettingsModel<TParent> {
    private readonly cache = new Map<string, Record<string, string>>();

    public constructor(
        private readonly getParentKey: (parent: TParent) => string,
        private readonly createClient: (parent: TParent) => IAppSettingsClient,
    ) { }

    /** Lists setting names in deterministic ordinal order and caches their values. */
    public async list(parent: TParent): Promise<string[]> {
        const settings = await this.createClient(parent).list();
        this.cache.set(this.getParentKey(parent), { ...settings });
        return Object.keys(settings).sort();
    }

    /** Returns a value from the most recently populated cache. */
    public getValue(parent: TParent, key: string): string | undefined {
        return this.getValueByParentKey(this.getParentKey(parent), key);
    }

    /** Returns a cached value when the caller already has the stable parent key. */
    public getValueByParentKey(parentKey: string, key: string): string | undefined {
        return this.cache.get(parentKey)?.[key];
    }

    /** Reads and caches all current settings, returning a defensive copy. */
    public async getAll(parent: TParent): Promise<Record<string, string>> {
        const settings = await this.createClient(parent).list();
        this.cache.set(this.getParentKey(parent), { ...settings });
        return { ...settings };
    }

    /** Adds or replaces one setting while preserving all other remote values. */
    public async addOrUpdate(parent: TParent, key: string, value: string): Promise<void> {
        const client = this.createClient(parent);
        const current = await client.list();
        const updated = await client.update({ ...current, [key]: value });
        this.cache.set(this.getParentKey(parent), { ...updated });
    }

    /** Deletes one setting while preserving all other remote values. */
    public async delete(parent: TParent, key: string): Promise<void> {
        const client = this.createClient(parent);
        const current = await client.list();
        const remaining = Object.fromEntries(Object.entries(current).filter(([settingKey]) => settingKey !== key));
        const updated = await client.update(remaining);
        this.cache.set(this.getParentKey(parent), { ...updated });
    }

    /** Renames one setting while preserving its value and all siblings. */
    public async rename(parent: TParent, oldKey: string, newKey: string): Promise<boolean> {
        const client = this.createClient(parent);
        const current = await client.list();
        if (!Object.hasOwn(current, oldKey)) {
            return false;
        }
        const value = current[oldKey];
        const renamed = Object.fromEntries(Object.entries(current).filter(([settingKey]) => settingKey !== oldKey));
        const updated = await client.update({ ...renamed, [newKey]: value });
        this.cache.set(this.getParentKey(parent), { ...updated });
        return true;
    }

    /** Replaces the complete remote settings collection. */
    public async replace(parent: TParent, settings: Record<string, string>): Promise<void> {
        const updated = await this.createClient(parent).update({ ...settings });
        this.cache.set(this.getParentKey(parent), { ...updated });
    }
}
