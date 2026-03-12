/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource as AzSdkGenericResource, ResourceGroup as AzSdkResourceGroup } from '@azure/arm-resources';
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { Satisfies } from '@microsoft/vscode-azure-utils';

/**
 * The ARM-level properties of an Azure resource, without any additional context.
 * Mirrors the fields returned by the Azure Resource Manager REST API.
 */
interface GenericResourceBase {
    /** The full ARM resource ID. */
    readonly id: string;
    /** The resource name. */
    readonly name: string;
    /** The ARM resource type, e.g. `Microsoft.Web/sites`. Generally, {@link GenericResource.logicalType} should be used instead. */
    readonly type: string;
    /** The Azure region. */
    readonly location: string;
    /** Resource tags. */
    readonly tags?: Readonly<Record<string, string>>;
    /** Resource kind (e.g. `functionapp`). */
    readonly kind?: string;
}

/**
 * Normalized representation of an Azure resource. Every ARM resource,
 * regardless of provider, satisfies this shape. Carries a reference to the
 * owning {@link AzureSubscription} for context (environment, credentials, etc.).
 */
export interface GenericResource extends GenericResourceBase {
    /** The subscription that owns this resource. */
    readonly subscription: AzureSubscription;
    /** The logical type of the resource. In most cases, it is the same as the ARM resource type. */
    readonly logicalType: string;
}

export const SiteType = 'Microsoft.Web/sites';
export const FunctionAppLogicalType = `${SiteType}~functionapp`;
export const WorkflowAppLogicalType = `${SiteType}~workflowapp`;
export const AppServiceLogicalType = `${SiteType}~app`;

export function attachMetadata(resource: Partial<GenericResourceBase>, subscription: AzureSubscription): GenericResource {
    if (!resource.type) {
        throw new Error(`Resource is missing required field "type": ${JSON.stringify(resource)}`);
    }

    return Object.assign(resource, {
        subscription,
        logicalType: logicalType(resource as GenericResourceBase)
    }) as GenericResource;
}

/**
 * Given a {@link GenericResource}, returns a "logical type" for grouping and identification purposes.
 * @param resource The resource
 */
function logicalType(resource: Pick<GenericResource, 'type' | 'kind'>): string {
    switch (resource.type.toLowerCase()) {
        case SiteType.toLowerCase(): {
            const kind = resource.kind?.toLowerCase();
            if (kind?.includes('functionapp')) {
                return FunctionAppLogicalType;
            } else if (kind?.includes('workflowapp')) { // TODO is this logicapps?
                return WorkflowAppLogicalType;
            } else {
                return AppServiceLogicalType;
            }
        }
        default:
            return resource.type;
    }
}

// ── Compile-time compatibility checks ───────────────────────────────────────────
// If the SDK output types ever drift (rename fields, change types), these will
// produce a compile error -- proving our GenericResourceBase stays in sync
// with the REST SDK output types.

type GenericResourceExpandedWithRequired = Required<Pick<AzSdkGenericResource, 'id' | 'name' | 'type' | 'location'>> & Pick<AzSdkGenericResource, 'tags' | 'kind'>;
type ResourceGroupOutputWithRequired = Required<Pick<AzSdkResourceGroup, 'id' | 'name' | 'type' | 'location'>> & Pick<AzSdkResourceGroup, 'tags'>;

/* eslint-disable @typescript-eslint/no-unused-vars */
// Forward: SDK types are assignable TO GenericResourceBase
type CheckExpandedOutput = Satisfies<GenericResourceBase, GenericResourceExpandedWithRequired>;
type CheckResourceGroupOutput = Satisfies<GenericResourceBase, ResourceGroupOutputWithRequired>;

// Reverse: GenericResourceBase is assignable TO the SDK picks (catches missing fields)
type CheckExpandedOutputReverse = Satisfies<GenericResourceExpandedWithRequired, GenericResourceBase>;
type CheckResourceGroupOutputReverse = Satisfies<ResourceGroupOutputWithRequired, GenericResourceBase>;
/* eslint-enable @typescript-eslint/no-unused-vars */
