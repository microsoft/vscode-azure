/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ICodeContext, getWorkspaceFolder, PromptStep, showSmartInputBox } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from './AzdWizardContext';

const NameRegex = /^[a-zA-Z0-9-]+$/;

/**
 * Prompts for a single project name and derives downstream defaults.
 *
 * Sets {@linkcode AzdWizardContext.projectName projectName},
 * {@linkcode AzdWizardContext.environmentName environmentName}, and
 * {@linkcode AzdWizardContext.azdServiceName azdServiceName} from one user
 * input. Skipped entirely when {@linkcode AzdWizardContext.environmentName environmentName}
 * is already populated -- typically because
 * {@linkcode HydrateAzdInfoStep} found an existing default azd environment in
 * {@linkcode AzdWizardContext.iacFolder iacFolder}.
 */
export class ProjectNameStep<TContext extends AzdWizardContext> extends PromptStep<TContext> {
    public constructor(
        private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<TContext>): boolean {
        return !context.projectName && !context.environmentName;
    }

    public async prompt(): Promise<Partial<TContext>> {
        const fallbackName = sanitize((await getWorkspaceFolder(this.ctx.code))?.name) ?? 'myapp';

        const name = await showSmartInputBox(this.ctx, {
            prompt: this.ctx.code.l10n.t('Enter a name for your project (used for the environment, service, and resource defaults)'),
            fallbackValue: fallbackName,
            showBack: true,
            validateInput: (value) => {
                if (!value) {
                    return this.ctx.code.l10n.t('Project name is required');
                } else if (!NameRegex.test(value)) {
                    return this.ctx.code.l10n.t('Only letters, numbers, and hyphens are allowed');
                }
                return undefined;
            },
        });

        return {
            projectName: name,
            environmentName: name,
            azdServiceName: name,
        } as Partial<TContext>;
    }
}

/** Strip characters that aren't allowed in azd environment / service names. */
function sanitize(name: string | undefined): string | undefined {
    if (!name) {
        return undefined;
    }
    const sanitized = name.replace(/[^a-zA-Z0-9-]/g, '-').replace(/^-+|-+$/g, '');
    return sanitized.length > 0 ? sanitized : undefined;
}
