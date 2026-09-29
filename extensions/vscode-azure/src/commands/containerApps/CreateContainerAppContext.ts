/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PickContext } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from '../../azd/wizard/AzdWizardContext';

/** Accumulated wizard context for Container App creation. */
export interface CreateContainerAppContext extends AzdWizardContext, PickContext<string> {
    /** Localized resource name used by the project folder picker. */
    readonly resourceDisplayName: string;
    /**
     * Port the container listens on, emitted as a Bicep parameter.
     *
     * Detected from the deployment project's Containerfile, or set to the
     * quickstart image's known port for app creation.
     */
    readonly targetPort?: number;
    /** azd environment expression emitted to preserve the deployed app's image on subsequent provisions. */
    readonly containerAppName?: string;
}
