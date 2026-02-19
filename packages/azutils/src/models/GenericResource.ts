/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GenericResourceExpandedOutput, ResourceGroupOutput } from '../rest/resources';

export type GenericResource =
    Required<Pick<GenericResourceExpandedOutput | ResourceGroupOutput, 'id' | 'name' | 'type' | 'location'>> & // Required properties that we expect to always be present
    Pick<GenericResourceExpandedOutput | ResourceGroupOutput, 'tags'> &
    Pick<GenericResourceExpandedOutput, 'kind'>; // Optional properties that may or may not be present depending on the resource
