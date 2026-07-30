/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';

/** Context value shared by resource-type groups with registered presentation metadata. */
export const ResourceTypeGroupContextValue = 'azureResourceTypeGroup';

/**
 * Presentation metadata for a supported Azure resource type.
 *
 * The logical type remains the stable identity for grouping and icon lookup;
 * this descriptor adds only localized view metadata.
 */
export interface ResourceTypePresentation {
    readonly logicalType: string;
    readonly getDisplayName: (code: IVsCode) => string;
    readonly groupContextValues?: readonly string[];
}

/** Identifier for the resource-type presentation registry used by the Azure resources tree. */
export const IResourceTypePresentationRegistry: ServiceIdentifier<IResourceTypePresentationRegistry> = Symbol.for('IResourceTypePresentationRegistry');

/** Resolves presentation metadata by logical type. */
export interface IResourceTypePresentationRegistry {
    /**
     * Looks up a descriptor case-insensitively.
     *
     * @returns The registered descriptor, or `undefined` when the type should
     * use generic resource-type group rendering.
     */
    getPresentation(logicalType: string): ResourceTypePresentation | undefined;
}

/**
 * Immutable, case-insensitive registry of supported resource-type presentations.
 *
 * Duplicate logical types are rejected during construction so registration
 * mistakes fail during extension activation rather than rendering inconsistently.
 */
export class ResourceTypePresentationRegistry implements IResourceTypePresentationRegistry {
    private readonly presentations = new Map<string, ResourceTypePresentation>();

    public constructor(presentations: readonly ResourceTypePresentation[]) {
        for (const presentation of presentations) {
            const key = normalizeLogicalType(presentation.logicalType);
            if (this.presentations.has(key)) {
                throw new Error(`Duplicate resource type presentation for "${presentation.logicalType}"`);
            }
            this.presentations.set(key, presentation);
        }
    }

    /** @inheritdoc */
    public getPresentation(logicalType: string): ResourceTypePresentation | undefined {
        return this.presentations.get(normalizeLogicalType(logicalType));
    }
}

function normalizeLogicalType(logicalType: string): string {
    return logicalType.toLowerCase();
}
