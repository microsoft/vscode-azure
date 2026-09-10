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
     * Detected from the deployment project's Containerfile, or supplied by the
     * user when creating an app from a custom image.
     */
    readonly targetPort?: number;
    /**
     * Image to deploy, when the user is deploying an image that already exists.
     *
     * Left unset for the `deploy` job, where azd builds and pushes the image
     * from the workspace and the Bicep falls back to a placeholder until it does.
     */
    readonly imageName?: string;
    /** ARM ID of the existing ACR from which the selected image is pulled. */
    readonly imageRegistryId?: string;
    /** azd environment expression emitted to preserve the deployed app's image on subsequent provisions. */
    readonly containerAppName?: string;
}
