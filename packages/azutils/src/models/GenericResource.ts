/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AssertAssignable } from '@microsoft/vscode-azure-utils';
import type { GenericResourceExpandedOutput, ResourceGroupOutput } from '../rest/resources';

/**
 * Normalized representation of an Azure resource. Every ARM resource —
 * regardless of provider — satisfies this shape.
 */
export interface GenericResource {
    /** The full ARM resource ID. */
    readonly id: string;
    /** The resource name. */
    readonly name: string;
    /** The ARM resource type, e.g. `Microsoft.Web/sites`. */
    readonly type: string;
    /** The Azure region. */
    readonly location: string;
    /** Resource tags. */
    tags?: Record<string, string>;
    /** Resource kind (e.g. `functionapp`). */
    kind?: string;
}

// ── Compile-time compatibility checks ───────────────────────────────────────────
// If the SDK output types ever drift (rename fields, change types), these will
// produce a compile error — proving GenericResource stays in sync.

/* eslint-disable @typescript-eslint/no-unused-vars */
// Forward: SDK types are assignable TO GenericResource
type CheckExpandedOutput = AssertAssignable<GenericResource, Required<Pick<GenericResourceExpandedOutput, 'id' | 'name' | 'type' | 'location'>> & Pick<GenericResourceExpandedOutput, 'tags' | 'kind'>>;
type CheckResourceGroupOutput = AssertAssignable<GenericResource, Required<Pick<ResourceGroupOutput, 'id' | 'name' | 'type' | 'location'>> & Pick<ResourceGroupOutput, 'tags'>>;

// Reverse: GenericResource is assignable TO the SDK picks (catches missing fields)
type CheckExpandedOutputReverse = AssertAssignable<Required<Pick<GenericResourceExpandedOutput, 'id' | 'name' | 'type' | 'location'>> & Pick<GenericResourceExpandedOutput, 'tags' | 'kind'>, GenericResource>;
type CheckResourceGroupOutputReverse = AssertAssignable<Required<Pick<ResourceGroupOutput, 'id' | 'name' | 'type' | 'location'>> & Pick<ResourceGroupOutput, 'tags'>, GenericResource>;
/* eslint-enable @typescript-eslint/no-unused-vars */
