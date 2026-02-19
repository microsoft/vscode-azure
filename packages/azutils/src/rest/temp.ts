/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource } from '../models/GenericResource';

export function mockGenericResources(count: number = 3): Promise<GenericResource[]> {
    return Promise.resolve(Array.from({ length: count }, (_, i) => ({
        id: `/subscriptions/mock/resourceGroups/rg/providers/Microsoft.Mock/resources/${i + 1}`,
        name: `resource-${i + 1}`,
        type: "Microsoft.Mock/resource"
    })));
}
