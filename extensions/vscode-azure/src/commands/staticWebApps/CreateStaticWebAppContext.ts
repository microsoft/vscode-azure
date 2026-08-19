/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PickContext } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from '../../azd/wizard/AzdWizardContext';
import type { StaticWebAppUnsupportedArtifactReason } from './deploymentRouting';
import type { StaticWebAppBuildPreset, StaticWebAppBuildPresetId } from './buildPresets';

/** Creation experience selected by the registered command ID. */
export type CreateStaticWebAppMode = 'basic' | 'advanced';

/** Static Web Apps plans exposed by the adapted creation wizard. */
export type StaticWebAppSkuName = 'Free' | 'Standard';

/** Languages emitted into an azd Static Web Apps service definition. */
export type StaticWebAppAzdLanguage = 'dotnet' | 'js' | 'ts';

/** Regions supported by the Static Web Apps creation API. */
export const staticWebAppLocationNames: ReadonlySet<string> = new Set([
    'centralus',
    'eastasia',
    'eastus2',
    'westeurope',
    'westus2',
]);

/** Accumulated context for azd-backed Static Web App creation. */
export interface CreateStaticWebAppContext extends AzdWizardContext, PickContext<string> {
    readonly mode: CreateStaticWebAppMode;
    readonly staticWebAppSkuName?: StaticWebAppSkuName;
    readonly buildPreset?: StaticWebAppBuildPreset;
    readonly buildPresetSelection?: StaticWebAppBuildPresetId | 'custom';
    readonly detectedFrameworks?: readonly StaticWebAppBuildPresetId[];
    readonly detectedApiLocations?: readonly string[];
    readonly detectedAppLocation?: string;
    readonly angularProjectName?: string;
    readonly detectedLanguage?: StaticWebAppAzdLanguage;
    readonly appLocation?: string;
    readonly apiLocation?: string;
    readonly outputLocation?: string;
    /**
     * Set by `DetermineStaticWebAppDeploymentRouteStep` when a supported,
     * pushed Git remote and a sufficient `azd` version make CI/CD setup
     * possible. When set, direct deploy (`AzdDeployStep`) is suppressed
     * (`deploy: false`) and `CreateStaticWebApp` launches the standalone
     * `DeployStaticWebApp` command with this info once the wizard succeeds.
     * Only ever set when {@linkcode deploymentUnsupportedArtifactReason} is
     * unset -- direct deployment must be supported before CI/CD is even
     * considered.
     */
    readonly deploymentRoute?: {
        readonly provider: 'github' | 'azdo';
        readonly repositoryUrl?: string;
        readonly branch?: string;
    };
    /**
     * Set by `DetermineStaticWebAppDeploymentRouteStep` when the artifact
     * shape cannot be deployed at all through this extension -- Next.js
     * hybrid/SSR, or any other shape `canAzdDeployStaticWebApp` flags as
     * unsupported (e.g. a missing/invalid existing service for a hydrated
     * project). Neither direct `azd deploy` nor a generated
     * `azd pipeline config` workflow (which only runs `azd deploy` too) can
     * help in either case, so the Git remote is never even inspected.
     * `deploy` is forced to `false`, and `CreateStaticWebApp` shows one
     * honest, reason-specific "provisioned only" message instead of claiming
     * (or silently skipping) a deployment -- see
     * {@linkcode StaticWebAppUnsupportedArtifactReason} for the distinction.
     */
    readonly deploymentUnsupportedArtifactReason?: StaticWebAppUnsupportedArtifactReason;
}
