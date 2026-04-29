/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { Location } from '@microsoft/vscode-azure-azutils';
import type * as vscode from 'vscode';

/**
 * Identifies which job-to-be-done the wizard is serving.
 *
 * - `createNew`: create an empty Azure resource with no workspace commitment.
 *   The IaC files live in a temp directory managed by
 *   {@linkcode TempProjectManager} and are disposed after provisioning.
 * - `deploy`: create a resource wired to the user's workspace project so
 *   subsequent `azd deploy` / `azd provision` runs work against the same
 *   `azure.yaml` and `infra/`.
 */
export type AzdJob = 'createNew' | 'deploy';

/** Shared wizard context for azd-backed resource creation wizards. */
export interface AzdWizardContext {
    readonly subscription?: AzureSubscription;
    readonly location?: Location;
    /** Name of the azd environment used to isolate state and resources. */
    readonly environmentName?: string;
    /** Value written as the `azd-service-name` tag on the resource so `azd deploy` can target it. */
    readonly azdServiceName?: string;
    /** Folder that holds (or will hold) the generated `azure.yaml` and `infra/` files. */
    readonly iacFolder?: vscode.Uri;
    /** If `true`, the wizard should provision after generating files. */
    readonly provision?: boolean;
    /** Selected job-to-be-done; set by the command entry point before the wizard runs. */
    readonly job?: AzdJob;
    /** Project-level name used to derive {@linkcode environmentName}, {@linkcode azdServiceName}, and resource defaults. */
    readonly projectName?: string;

    // ---- Hydration flags (set by HydrateAzdInfoStep, deploy job only) ----
    /** `true` when `azure.yaml` (or `azure.yml`) is present in {@linkcode iacFolder}. */
    readonly hasAzureYaml?: boolean;
    /** `true` when {@linkcode iacFolder} contains an `infra/main.bicep` (and we should not regenerate it). */
    readonly hasInfra?: boolean;
    /** `true` when an existing `azure.yaml` already declares a `services:` entry. */
    readonly hasServices?: boolean;
    /** Name of the existing default azd environment in {@linkcode iacFolder}, if any. */
    readonly existingDefaultEnvName?: string;
    /**
     * `AZURE_SUBSCRIPTION_ID` from the existing default environment, if any.
     * Used by {@linkcode HydratableChooseSubscriptionStep} to skip the picker.
     */
    readonly hydratedSubscriptionId?: string;
    /**
     * `AZURE_LOCATION` from the existing default environment, if any.
     * Used by {@linkcode HydratableChooseLocationStep} to skip the picker.
     */
    readonly hydratedLocationName?: string;
}
