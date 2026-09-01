/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessSet, type ICaselessSetReader, type PickContext } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from '../../azd/wizard/AzdWizardContext';
import type { StaticWebAppsCliConfigFile } from '../../staticWebApps/SwaCliConfig';

/** Languages emitted into an azd Static Web Apps service definition. */
export type StaticWebAppAzdLanguage = 'dotnet' | 'js' | 'python';

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
    /** Language recorded on the azd service definition. */
    readonly detectedLanguage?: StaticWebAppAzdLanguage;
    readonly appLocation?: string;
    readonly apiLocation?: string;
    /** Build output, relative to {@linkcode appLocation}. */
    readonly outputLocation?: string;
    /** Configuration that lets azd delegate app and API builds to the SWA CLI. */
    readonly swaCliConfig?: StaticWebAppsCliConfigFile;
    /** Whether {@linkcode swaCliConfig} must be materialized after confirmation. */
    readonly swaCliConfigNeedsWrite?: boolean;
}
