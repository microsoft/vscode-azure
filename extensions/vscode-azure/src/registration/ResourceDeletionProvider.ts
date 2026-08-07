/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConcreteAzureNode, GenericResource } from '@microsoft/vscode-azure-azutils';
import type { ServiceIdentifier } from 'inversify';

/** Confirmation shown before a deletion operation runs. */
export type ResourceDeletionConfirmation =
    | { readonly kind: 'modal'; readonly message: string }
    | { readonly kind: 'typed'; readonly prompt: string; readonly expectedValue: string };

/**
 * Complete description of one deletion operation.
 *
 * Product-specific providers may return a partial plan. Matching plans are
 * merged in registration order, allowing a product to override confirmation
 * or execution while inheriting the generic ARM defaults.
 */
export interface ResourceDeletionPlan {
    /** User-facing name of the target. */
    readonly resourceName: string;
    /** Confirmation required before deletion. */
    readonly confirmation: ResourceDeletionConfirmation;
    /** Performs the remote deletion and resolves only after it completes. */
    readonly delete: () => Promise<void>;
    /** Node or key removed from the resource tree after successful deletion. */
    readonly cacheTarget: ConcreteAzureNode | string;
    /** Localized notification shown after successful deletion. */
    readonly successMessage: string;
    /** ARM target used to determine whether azd owns this deletion. */
    readonly azdTarget?: GenericResource;
    /** Non-PII telemetry classification for the selected provider. */
    readonly telemetryType?: string;
}

/**
 * Contributes deletion behavior for matching Azure tree nodes.
 *
 * Providers are evaluated in registration order. Earlier, product-specific
 * partial plans override later generic defaults.
 */
export interface ResourceDeletionProvider {
    canHandle(resource: ConcreteAzureNode): boolean;
    getPlan(resource: ConcreteAzureNode): Partial<ResourceDeletionPlan> | Promise<Partial<ResourceDeletionPlan>>;
}

/** Identifier for the ordered collection of product deletion providers. */
export const IResourceDeletionProvider: ServiceIdentifier<ResourceDeletionProvider> = Symbol.for('IResourceDeletionProvider');
