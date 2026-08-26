/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PickContext } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from '../../azd/wizard/AzdWizardContext';

/** Accumulated wizard context for Container App creation. */
export interface CreateContainerAppContext extends AzdWizardContext, PickContext<string> {
    /**
     * Port the container listens on, emitted as a Bicep parameter.
     *
     * Detected from the project's Dockerfile rather than prompted for: the value
     * is already declared there, and the generated Bicep is editable if the
     * guess is wrong.
     */
    readonly targetPort?: number;
    /**
     * Image to deploy, when the user is deploying an image that already exists.
     *
     * Left unset for the `deploy` job, where azd builds and pushes the image
     * from the workspace and the Bicep falls back to a placeholder until it does.
     */
    readonly imageName?: string;
}
