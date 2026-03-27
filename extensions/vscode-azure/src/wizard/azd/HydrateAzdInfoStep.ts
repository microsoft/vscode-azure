/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptStep } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from './AzdWizardContext';

export class HydrateAzdInfoStep<TContext extends AzdWizardContext> extends PromptStep<TContext> {
    public shouldPrompt(): boolean {
        return true; // TODO: If azure.yaml exists?
    }

    public prompt(): Promise<Partial<TContext>> {
        // Preload any existing project information that we can find
        throw new Error('unimpl');
    }
}
