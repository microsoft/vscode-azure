/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessSet, type ICaselessSetReader, type PickContext } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from '../../azd/wizard/AzdWizardContext';
import type { StaticWebAppBuildPreset, StaticWebAppBuildPresetId } from './buildPresets';

/** Languages emitted into an azd Static Web Apps service definition. */
export type StaticWebAppAzdLanguage = 'dotnet' | 'js' | 'ts';

/** Regions supported by the Static Web Apps creation API. */
export const staticWebAppLocationNames: ICaselessSetReader = new CaselessSet([
    'centralus',
    'eastasia',
    'eastus2',
    'westeurope',
    'westus2',
]);

/** Accumulated context for azd-backed Static Web App creation. */
export interface CreateStaticWebAppContext extends AzdWizardContext, PickContext<string> {
    /** Always set; shared prompts name the product rather than assuming one. */
    readonly resourceDisplayName: string;
    readonly buildPreset?: StaticWebAppBuildPreset;
    readonly buildPresetSelection?: StaticWebAppBuildPresetId | 'custom';
    readonly detectedFrameworks?: readonly StaticWebAppBuildPresetId[];
    readonly detectedApiLocations?: readonly string[];
    readonly detectedAppLocation?: string;
    /** Build output read from the project's build configuration, when it states one. */
    readonly detectedOutputLocation?: string;
    readonly angularProjectName?: string;
    readonly detectedLanguage?: StaticWebAppAzdLanguage;
    readonly appLocation?: string;
    readonly apiLocation?: string;
    readonly outputLocation?: string;
}
