/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription, Location } from '@microsoft/vscode-azure-azutils';
import type * as vscode from 'vscode';

/**
 * Identifies which job-to-be-done the wizard is serving.
 *
 * - `createNew`: create an empty Azure resource with no workspace commitment.
 *   The IaC files live in a temp directory managed by
 *   {@linkcode TempDirManager} and are disposed after provisioning.
 * - `deploy`: create a resource wired to the user's workspace project so
 *   subsequent `azd deploy` / `azd provision` runs work against the same
 *   `azure.yaml` and `infra/`.
 */
export type AzdJob = 'createNew' | 'deploy';

/** Shared wizard context for azd-backed resource creation wizards. */
export interface AzdWizardContext {
    readonly subscription?: AzureSubscription;
    readonly location?: Location;
    /**
     * Optional allow-list for resource types available in only a subset of regions.
     * Matched case-insensitively by {@linkcode ChooseLocationStep}.
     */
    readonly allowedLocationNames?: Iterable<string>;
    /** Name of the azd environment used to isolate state and resources. */
    readonly environmentName?: string;
    /** Value written as the `azd-service-name` tag on the resource so `azd deploy` can target it. */
    readonly azdServiceName?: string;
    /** Folder that holds (or will hold) the generated `azure.yaml` and `infra/` files. */
    readonly iacFolder?: vscode.Uri;
    /** If `true`, the wizard should provision after generating files. */
    readonly provision?: boolean;
    /** If `true`, the wizard should deploy code after provisioning. */
    readonly deploy?: boolean;
    /** Selected job-to-be-done; set by the command entry point before the wizard runs. */
    readonly job?: AzdJob;
    /**
     * Localized resource name used by shared prompts, e.g. `'Function App'` or
     * `'Static Web App'`.
     *
     * Optional here because product-agnostic entry points (`azd up` / `azd down`)
     * name no single resource and never reach a prompt that uses it. Wizards that
     * set {@linkcode AzdWizardContext.job job} to `'deploy'` must supply it, and
     * their contexts redeclare it as required so the compiler enforces that.
     */
    readonly resourceDisplayName?: string;
    // ---- Hydration flags (set by HydrateAzdInfoStep, deploy job only) ----
    /** `true` when `azure.yaml` (or `azure.yml`) is present in {@linkcode iacFolder}. */
    readonly hasAzureYaml?: boolean;
    /** `true` when {@linkcode iacFolder} contains an `infra/main.bicep` (and we should not regenerate it). */
    readonly hasInfra?: boolean;
    /** `true` when an existing `azure.yaml` already declares a `services:` entry. */
    readonly hasServices?: boolean;
    /**
     * Absolute project path from `azd show`, only when exactly one service exists.
     * May identify a project file (for example, a `.csproj`) rather than a directory.
     */
    readonly hydratedServiceProjectPath?: string;
    /** Name of the existing default azd environment in {@linkcode iacFolder}, if any. */
    readonly existingDefaultEnvName?: string;
    /**
     * `AZURE_SUBSCRIPTION_ID` from the existing default environment, if any.
     * Used by {@linkcode HydratableChooseSubscriptionStep} to skip the picker.
     */
    readonly hydratedSubscriptionId?: string;
    /**
     * `AZURE_TENANT_ID` from the existing default environment, if any (only set
     * when the env is fully configured, so it is the owning tenant of
     * {@linkcode hydratedSubscriptionId}). Used as a fast-path hint when resolving
     * the subscription of deployments produced by this provision.
     */
    readonly hydratedTenantId?: string;
    /**
     * `AZURE_LOCATION` from the existing default environment, if any.
     * Used by {@linkcode HydratableChooseLocationStep} to skip the picker.
     */
    readonly hydratedLocationName?: string;
}
