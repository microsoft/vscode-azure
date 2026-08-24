/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    isGenericResource,
    isVirtualResource,
    StaticWebAppResourceType,
    type GenericResource,
    type StaticSiteARMResource,
    type StaticSiteBuildARMResource,
    type StaticSiteFunctionOverviewARMResource,
    type VirtualResource,
} from '@microsoft/vscode-azure-azutils';
import type { IVsCode } from '@microsoft/vscode-azure-utils';

/** Enriched Azure Static Web App resource retained in the Azure data tree. */
export interface StaticWebApp extends GenericResource {
    /** Full management-plane payload from the latest enrichment. */
    staticSite?: StaticSiteARMResource;
    /** Production source branch, when supplied by Azure. */
    branch?: string;
    /** Default Azure hostname, when provisioned. */
    defaultHostname?: string;
}

/** Stable virtual discriminators for every Static Web Apps child node. */
export const StaticWebAppVirtualTypes = {
    Environment: 'staticWebApp.environment',
    Functions: 'staticWebApp.functions',
    Function: 'staticWebApp.function',
    NoFunctions: 'staticWebApp.noFunctions',
    Invalid: 'staticWebApp.invalid',
} as const;

/** Context values used for auditable malformed-child placeholders. */
export type StaticWebAppInvalidContext =
    | 'invalidStaticEnvironment'
    | 'invalidFunction';

interface StaticWebAppVirtualBase extends VirtualResource {
    readonly azureResource: StaticWebApp;
}

/** A production or preview environment returned by Azure Static Web Apps. */
export interface StaticWebAppEnvironment extends StaticWebAppVirtualBase {
    readonly virtualType: typeof StaticWebAppVirtualTypes.Environment;
    readonly data: StaticSiteBuildARMResource;
    readonly buildId: string;
    readonly branch: string;
    readonly isProduction: boolean;
    readonly hostname?: string;
    readonly status?: string;
}

/** Azure Functions category for one environment. */
export interface StaticWebAppFunctions extends StaticWebAppVirtualBase {
    readonly virtualType: typeof StaticWebAppVirtualTypes.Functions;
    readonly environmentBuildId: string;
    readonly isProduction: boolean;
}

/** Function leaf returned by the Static Web Apps management API. */
export interface StaticWebAppFunction extends StaticWebAppVirtualBase {
    readonly virtualType: typeof StaticWebAppVirtualTypes.Function;
    readonly environmentBuildId: string;
    readonly data: StaticSiteFunctionOverviewARMResource;
    readonly functionName: string;
}

/** Distinguishes environment-level API guidance from an empty function list. */
export type NoFunctionsKind = 'help' | 'empty';

/** No-functions placeholder used in two distinct tree locations. */
export interface StaticWebAppNoFunctions extends StaticWebAppVirtualBase {
    readonly virtualType: typeof StaticWebAppVirtualTypes.NoFunctions;
    readonly kind: NoFunctionsKind;
}

/** Placeholder for malformed data returned within an otherwise valid collection. */
export interface InvalidStaticWebAppNode extends StaticWebAppVirtualBase {
    readonly virtualType: typeof StaticWebAppVirtualTypes.Invalid;
    readonly invalidContextValue: StaticWebAppInvalidContext;
    /** Whatever name the malformed payload carried, or `undefined` when it had none. */
    readonly sourceLabel?: string;
}

/** All Static Web Apps-owned virtual resources stored in the Azure data tree. */
export type StaticWebAppVirtualNode =
    | StaticWebAppEnvironment
    | StaticWebAppFunctions
    | StaticWebAppFunction
    | StaticWebAppNoFunctions
    | InvalidStaticWebAppNode;

const knownVirtualTypes = new Set<string>(Object.values(StaticWebAppVirtualTypes));

/**
 * Narrows a generic ARM resource to Azure Static Web Apps.
 *
 * Both the ARM type and normalized logical type are accepted
 * case-insensitively so listings remain robust across SDK casing.
 */
export function isStaticWebApp(node: unknown): node is StaticWebApp {
    if (!node || typeof node !== 'object' || !isGenericResource(node)) {
        return false;
    }

    return node.type.toLowerCase() === StaticWebAppResourceType.toLowerCase()
        || node.logicalType.toLowerCase() === StaticWebAppResourceType.toLowerCase();
}

/** Narrows a virtual resource to a known Static Web Apps child variant. */
export function isStaticWebAppVirtualNode(node: unknown): node is StaticWebAppVirtualNode {
    return !!node
        && typeof node === 'object'
        && isVirtualResource(node as VirtualResource)
        && knownVirtualTypes.has((node as VirtualResource).virtualType)
        && isStaticWebApp((node as VirtualResource).azureResource);
}

/** Narrows any value to a Static Web Apps environment node. */
export function isStaticWebAppEnvironment(node: unknown): node is StaticWebAppEnvironment {
    return isStaticWebAppVirtualNode(node) && node.virtualType === StaticWebAppVirtualTypes.Environment;
}

/** Normalizes Azure's `GitHubAccount:branch` preview-branch format. */
export function normalizeStaticWebAppBranch(sourceBranch: string): string {
    const separator = sourceBranch.indexOf(':');
    return separator < 0 ? sourceBranch : sourceBranch.slice(separator + 1);
}

/**
 * The name an environment is shown under, wherever it is named to a user.
 *
 * Production is the only environment Azure does not name, so it is the only one given a
 * localized label; every other environment is named after the pull request that created it,
 * which is arbitrary user-authored text that must not be translated.
 *
 * Kept out of the node itself so the data layer stores only what Azure returned -- see
 * {@linkcode getStaticWebAppEnvironmentSortKey} for the ordering counterpart.
 */
export function getStaticWebAppEnvironmentLabel(code: IVsCode, environment: StaticWebAppEnvironment): string {
    return environment.isProduction
        ? code.l10n.t('Production')
        : getStaticWebAppEnvironmentSortKey(environment);
}

/**
 * The environment's untranslated name, for ordering.
 *
 * Production never reaches a comparison against this -- it is ordered first on
 * {@linkcode StaticWebAppEnvironment.isProduction} -- so ordering never needs the localized
 * label and the data layer never needs to produce one.
 */
export function getStaticWebAppEnvironmentSortKey(environment: StaticWebAppEnvironment): string {
    return environment.data.pullRequestTitle ?? environment.data.name ?? environment.buildId;
}

/** The name a malformed node is shown under, falling back when the payload carried none. */
export function getInvalidStaticWebAppNodeLabel(code: IVsCode, node: InvalidStaticWebAppNode): string {
    return node.sourceLabel || code.l10n.t('Some items could not be displayed');
}
