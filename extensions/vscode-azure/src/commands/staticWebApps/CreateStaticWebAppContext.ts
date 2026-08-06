/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PickContext } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from '../../azd/wizard/AzdWizardContext';
import type { StaticWebAppBuildPreset, StaticWebAppBuildPresetId } from './buildPresets';

/** Creation experience selected by the registered command ID. */
export type CreateStaticWebAppMode = 'basic' | 'advanced';

/** Static Web Apps plans exposed by the adapted creation wizard. */
export type StaticWebAppSkuName = 'Free' | 'Standard';

/** Languages emitted into an azd Static Web Apps service definition. */
export type StaticWebAppAzdLanguage = 'dotnet' | 'js' | 'ts';

/**
 * Reason CI/CD setup could not be routed to after creation, when the
 * artifact shape also cannot be deployed directly (Next.js hybrid/SSR).
 * Drives the reason-specific post-wizard guidance message in
 * `CreateStaticWebApp`.
 */
export type StaticWebAppDeploymentBlockedReason = 'noRemote' | 'unsupportedRemote' | 'notPushed' | 'azdVersionTooLow';

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
    /** Existing GitHub remote URL retained as resource metadata without a token. */
    readonly repositoryUrl?: string;
    /** Existing local branch retained with {@linkcode repositoryUrl}. */
    readonly branch?: string;
    /**
     * Set by `DetermineStaticWebAppDeploymentRouteStep` when a supported,
     * pushed Git remote and a sufficient `azd` version make CI/CD setup
     * possible. When set, direct deploy (`AzdDeployStep`) is suppressed
     * (`deploy: false`) and `CreateStaticWebApp` launches the standalone
     * `DeployStaticWebApp` command with this info once the wizard succeeds.
     */
    readonly deploymentRoute?: {
        readonly provider: 'github' | 'azdo';
        readonly repositoryUrl?: string;
        readonly branch?: string;
    };
    /**
     * Set by `DetermineStaticWebAppDeploymentRouteStep` when the artifact
     * shape cannot be deployed directly (Next.js hybrid/SSR) *and* CI/CD is
     * not currently possible for the reason given. `deploy` is also forced
     * to `false` in this case -- no deployment happens by any path, and
     * `CreateStaticWebApp` shows reason-specific guidance instead of
     * claiming success.
     */
    readonly deploymentBlockedReason?: StaticWebAppDeploymentBlockedReason;
}
