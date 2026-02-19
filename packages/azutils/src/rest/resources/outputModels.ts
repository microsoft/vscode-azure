/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Hand-authored REST output types for Microsoft.Resources.
// Follows the same pattern as @azure-rest/arm-appservice.

// ── Resource Group ──────────────────────────────────────────────────────────────

/** Resource group information (response). */
export interface ResourceGroupOutput {
    /** The ID of the resource group. */
    readonly id?: string;
    /** The name of the resource group. */
    readonly name?: string;
    /** The type of the resource group. */
    readonly type?: string;
    /** The location of the resource group. */
    location: string;
    /** The tags attached to the resource group. */
    tags?: Record<string, string>;
    /** The ID of the resource that manages this resource group. */
    managedBy?: string;
    /** The resource group properties. */
    properties?: ResourceGroupPropertiesOutput;
}

/** The resource group properties. */
export interface ResourceGroupPropertiesOutput {
    /** The provisioning state. */
    readonly provisioningState?: string;
}

/** List of resource groups. */
export interface ResourceGroupListResultOutput {
    /** An array of resource groups. */
    value?: Array<ResourceGroupOutput>;
    /** The URL to use for getting the next set of results. */
    readonly nextLink?: string;
}

// ── Generic Resource ────────────────────────────────────────────────────────────

/** Resource information (response). */
export interface GenericResourceExpandedOutput {
    /** Resource ID. */
    readonly id?: string;
    /** Resource name. */
    readonly name?: string;
    /** Resource type. */
    readonly type?: string;
    /** Resource location. */
    location?: string;
    /** The extended location of the resource. */
    extendedLocation?: ExtendedLocationOutput;
    /** Resource tags. */
    tags?: Record<string, string>;
    /** The plan of the resource. */
    plan?: PlanOutput;
    /** The resource properties. */
    properties?: Record<string, unknown>;
    /** The kind of the resource. */
    kind?: string;
    /** The ID of the resource that manages this resource. */
    managedBy?: string;
    /** The SKU of the resource. */
    sku?: SkuOutput;
    /** The identity of the resource. */
    identity?: IdentityOutput;
    /** The created time of the resource. */
    readonly createdTime?: string;
    /** The changed time of the resource. */
    readonly changedTime?: string;
    /** The provisioning state of the resource. */
    readonly provisioningState?: string;
}

/** Resource extended location. */
export interface ExtendedLocationOutput {
    /** The extended location type. */
    type?: string;
    /** The extended location name. */
    name?: string;
}

/** Plan for the resource. */
export interface PlanOutput {
    /** The plan ID. */
    name?: string;
    /** The publisher ID. */
    publisher?: string;
    /** The offer ID. */
    product?: string;
    /** The promotion code. */
    promotionCode?: string;
    /** The plan's version. */
    version?: string;
}

/** SKU for the resource. */
export interface SkuOutput {
    /** The SKU name. */
    name?: string;
    /** The SKU tier. */
    tier?: string;
    /** The SKU size. */
    size?: string;
    /** The SKU family. */
    family?: string;
    /** The SKU model. */
    model?: string;
    /** The SKU capacity. */
    capacity?: number;
}

/** Identity for the resource. */
export interface IdentityOutput {
    /** The principal ID of resource identity. */
    readonly principalId?: string;
    /** The tenant ID of resource. */
    readonly tenantId?: string;
    /** The identity type. */
    type?: 'SystemAssigned' | 'UserAssigned' | 'SystemAssigned, UserAssigned' | 'None';
}

/** List of resource groups. */
export interface ResourceListResultOutput {
    /** An array of resources. */
    value?: Array<GenericResourceExpandedOutput>;
    /** The URL to use for getting the next set of results. */
    readonly nextLink?: string;
}

// ── Error ───────────────────────────────────────────────────────────────────────

/** An error response from the service. */
export interface CloudErrorOutput {
    /** The error details. */
    error?: ErrorDetailOutput;
}

/** The error detail. */
export interface ErrorDetailOutput {
    /** The error code. */
    readonly code?: string;
    /** The error message. */
    readonly message?: string;
    /** The error target. */
    readonly target?: string;
    /** The error details. */
    readonly details?: Array<ErrorDetailOutput>;
}
