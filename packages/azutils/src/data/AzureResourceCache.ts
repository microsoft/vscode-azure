/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Cache, type CacheKey } from '@microsoft/vscode-azure-utils';
import type { GenericResource } from '../models/GenericResource';

export class AzureResourceKey implements CacheKey {
    public constructor(
        public readonly accountId: string,
        public readonly tenantId: string,
        public readonly resourceId: string
    ) { }

    public toString(): string {
        return `${this.accountId}/${this.tenantId}/${this.resourceId}`.toLowerCase();
    }

    public static fromString(key: string): AzureResourceKey {
        const [accountId, tenantId, ...resourceIdParts] = key.toLowerCase().split('/');
        return new AzureResourceKey(accountId, tenantId, resourceIdParts.join('/'));
    }
}

export class AzureResourceCache<TResource extends GenericResource> extends Cache<AzureResourceKey, TResource> {
    // TODO: add some secondary indexes to speed up invalidation?
    public invalidateByAccountId(accountId: string): void {
        this.invalidate(key => key.accountId === accountId);
    }

    public invalidateByResourceId(resourceId: string): void {
        this.invalidate(key => key.resourceId === resourceId);
    }

    public invalidateByResourceIdPrefix(resourceIdPrefix: string): void {
        this.invalidate(key => key.resourceId.startsWith(resourceIdPrefix));
    }
}
