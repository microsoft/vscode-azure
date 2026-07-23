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
}
