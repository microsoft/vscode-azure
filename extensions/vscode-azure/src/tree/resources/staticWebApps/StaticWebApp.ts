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
import type { GitHubJob, GitHubRepository, GitHubWorkflowRun, GitHubWorkflowStep } from '../../../services/StaticWebAppsGitHubService';
import type * as vscode from 'vscode';
import type { ParsedWorkflow, WorkflowBuildConfig, WorkflowSourceRange } from './workflowParser';

/** Enriched Azure Static Web App resource retained in the Azure data tree. */
export interface StaticWebApp extends GenericResource {
    /** Full management-plane payload from the latest enrichment. */
    staticSite?: StaticSiteARMResource;
    /** GitHub repository URL, when the site is source-linked. */
    repositoryUrl?: string;
    /** Production source branch, when supplied by Azure. */
    branch?: string;
    /** Default Azure hostname, when provisioned. */
    defaultHostname?: string;
}

/** Stable virtual discriminators for every Static Web Apps child node. */
export const StaticWebAppVirtualTypes = {
    Environment: 'staticWebApp.environment',
    Actions: 'staticWebApp.actions',
    Action: 'staticWebApp.action',
    Job: 'staticWebApp.job',
    Step: 'staticWebApp.step',
    Functions: 'staticWebApp.functions',
    Function: 'staticWebApp.function',
    AppSettings: 'staticWebApp.appSettings',
    AppSetting: 'staticWebApp.appSetting',
    NoFunctions: 'staticWebApp.noFunctions',
    WorkflowGroup: 'staticWebApp.workflowGroup',
    Workflow: 'staticWebApp.workflow',
    WorkflowParseError: 'staticWebApp.workflowParseError',
    Invalid: 'staticWebApp.invalid',
} as const;

/** Context values used for auditable malformed-child placeholders. */
export type StaticWebAppInvalidContext =
    | 'invalidStaticEnvironment'
    | 'invalidActionTreeItem'
    | 'invalidJobTreeItem'
    | 'invalidStepTreeItem'
    | 'invalidFunction';

interface StaticWebAppVirtualBase extends VirtualResource {
    readonly azureResource: StaticWebApp;
    /** Optional ARM subresource path used by the generic portal command. */
    readonly portalResourceId?: string;
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
    readonly displayLabel: string;
    readonly inWorkspace: boolean;
    readonly localRepositoryUri?: vscode.Uri;
}

/** GitHub Actions category for one environment branch. */
export interface StaticWebAppActions extends StaticWebAppVirtualBase {
    readonly virtualType: typeof StaticWebAppVirtualTypes.Actions;
    readonly environmentBuildId: string;
    readonly branch: string;
    readonly repository?: GitHubRepository;
}

/** GitHub Actions workflow run. */
export interface StaticWebAppAction extends StaticWebAppVirtualBase {
    readonly virtualType: typeof StaticWebAppVirtualTypes.Action;
    readonly repository: GitHubRepository;
    readonly run: GitHubWorkflowRun;
}

/** GitHub Actions job within a workflow run. */
export interface StaticWebAppJob extends StaticWebAppVirtualBase {
    readonly virtualType: typeof StaticWebAppVirtualTypes.Job;
    readonly repository: GitHubRepository;
    readonly runId: number;
    readonly job: GitHubJob;
}

/** GitHub Actions step within a job. */
export interface StaticWebAppStep extends StaticWebAppVirtualBase {
    readonly virtualType: typeof StaticWebAppVirtualTypes.Step;
    readonly repository: GitHubRepository;
    readonly jobId: number;
    readonly step: GitHubWorkflowStep;
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

/** App-settings category for a production or preview Functions API. */
export interface StaticWebAppAppSettingsGroup extends StaticWebAppVirtualBase {
    readonly virtualType: typeof StaticWebAppVirtualTypes.AppSettings;
    readonly environmentBuildId: string;
    readonly isProduction: boolean;
    readonly branch: string;
}

/** App-setting leaf. Values are intentionally kept out of tree-node data. */
export interface StaticWebAppAppSetting extends StaticWebAppVirtualBase {
    readonly virtualType: typeof StaticWebAppVirtualTypes.AppSetting;
    readonly environmentBuildId: string;
    readonly isProduction: boolean;
    readonly branch: string;
    readonly settingName: string;
    /** Command-facing parent handle; values remain in the provider's private cache. */
    readonly appSettingsGroup: StaticWebAppAppSettingsGroup;
}

/** Distinguishes environment-level API guidance from an empty function list. */
export type NoFunctionsKind = 'help' | 'empty';

/** No-functions placeholder used in two distinct tree locations. */
export interface StaticWebAppNoFunctions extends StaticWebAppVirtualBase {
    readonly virtualType: typeof StaticWebAppVirtualTypes.NoFunctions;
    readonly kind: NoFunctionsKind;
}

/** Workflow file group parsed from a matching local repository and branch. */
export interface StaticWebAppWorkflowGroup extends StaticWebAppVirtualBase {
    readonly virtualType: typeof StaticWebAppVirtualTypes.WorkflowGroup;
    readonly workflow: ParsedWorkflow;
}

/** One editable build setting from a Static Web Apps deployment workflow. */
export interface StaticWebAppWorkflow extends StaticWebAppVirtualBase {
    readonly virtualType: typeof StaticWebAppVirtualTypes.Workflow;
    readonly uri: ParsedWorkflow['uri'];
    readonly buildConfig: WorkflowBuildConfig;
    readonly value: string;
    readonly selectionRange: WorkflowSourceRange;
}

/** YAML parse-error child preserving source location for the future open command. */
export interface StaticWebAppWorkflowParseError extends StaticWebAppVirtualBase {
    readonly virtualType: typeof StaticWebAppVirtualTypes.WorkflowParseError;
    readonly uri: ParsedWorkflow['uri'];
    readonly errorRange: WorkflowSourceRange;
}

/** Placeholder for malformed data returned within an otherwise valid collection. */
export interface InvalidStaticWebAppNode extends StaticWebAppVirtualBase {
    readonly virtualType: typeof StaticWebAppVirtualTypes.Invalid;
    readonly invalidContextValue: StaticWebAppInvalidContext;
    readonly displayLabel: string;
}

/** All Static Web Apps-owned virtual resources stored in the Azure data tree. */
export type StaticWebAppVirtualNode =
    | StaticWebAppEnvironment
    | StaticWebAppActions
    | StaticWebAppAction
    | StaticWebAppJob
    | StaticWebAppStep
    | StaticWebAppFunctions
    | StaticWebAppFunction
    | StaticWebAppAppSettingsGroup
    | StaticWebAppAppSetting
    | StaticWebAppNoFunctions
    | StaticWebAppWorkflowGroup
    | StaticWebAppWorkflow
    | StaticWebAppWorkflowParseError
    | InvalidStaticWebAppNode;

const knownVirtualTypes = new Set<string>(Object.values(StaticWebAppVirtualTypes));

/**
 * Narrows a generic ARM resource to Azure Static Web Apps.
 *
 * Both the ARM type and normalized logical type are accepted
 * case-insensitively so listings remain robust across SDK casing.
 */
export function isStaticWebApp(node: unknown): node is StaticWebApp {
    if (!node || typeof node !== 'object' || !isGenericResource(node as GenericResource)) {
        return false;
    }

    const resource = node as GenericResource;
    return resource.type.toLowerCase() === StaticWebAppResourceType.toLowerCase()
        || resource.logicalType.toLowerCase() === StaticWebAppResourceType.toLowerCase();
}

/** Narrows a virtual resource to a known Static Web Apps child variant. */
export function isStaticWebAppVirtualNode(node: unknown): node is StaticWebAppVirtualNode {
    return !!node
        && typeof node === 'object'
        && isVirtualResource(node as VirtualResource)
        && knownVirtualTypes.has((node as VirtualResource).virtualType)
        && isStaticWebApp((node as VirtualResource).azureResource);
}

/** Normalizes Azure's `GitHubAccount:branch` preview-branch format. */
export function normalizeStaticWebAppBranch(sourceBranch: string): string {
    const separator = sourceBranch.indexOf(':');
    return separator < 0 ? sourceBranch : sourceBranch.slice(separator + 1);
}
