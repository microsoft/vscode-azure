/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GenericResource } from './GenericResource';

export interface VirtualResource {
    readonly virtualType: string;
    readonly path: string;
    readonly azureResource: GenericResource;
}
