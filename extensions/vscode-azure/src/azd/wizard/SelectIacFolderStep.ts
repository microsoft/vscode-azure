/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWorkspaceFolder, type ICodeContext, PromptStep } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from './AzdWizardContext';
import type { TempProjectManager } from './TempProjectManager';

/**
 * Picks the {@linkcode AzdWizardContext.iacFolder iacFolder} based on
 * {@linkcode AzdWizardContext.job job}:
 *
 * - `createNew`: allocates a temp directory via {@linkcode TempProjectManager}.
 *   The workspace is never touched.
 * - `deploy`: prompts the user to pick a workspace folder (silent in
 *   single-root workspaces, shows a picker in multi-root). Dismissing the
 *   picker bubbles up as a {@linkcode CancellationError} from
 *   {@linkcode getWorkspaceFolder}; an empty workspace throws an explanatory
 *   error since the deploy job has nothing to write IaC into.
 *
 * Skipped when {@linkcode AzdWizardContext.iacFolder iacFolder} is already
 * set (e.g. by a future caller that pre-seeds it).
 */
export class SelectIacFolderStep<TContext extends AzdWizardContext> extends PromptStep<TContext> {
    public constructor(
        private readonly ctx: ICodeContext,
        private readonly tempManager: TempProjectManager,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<TContext>): boolean {
        return !context.iacFolder;
    }

    public async prompt(context: Readonly<TContext>): Promise<Partial<TContext>> {
        if (context.job === 'createNew') {
            const iacFolder = await this.tempManager.createProjectDir();
            return { iacFolder } as Partial<TContext>;
        }

        const folder = await getWorkspaceFolder(
            this.ctx.code,
            this.ctx.code.l10n.t('Select a workspace folder to deploy as a Function App'),
        );
        if (!folder) {
            // getWorkspaceFolder returns undefined only when no workspace
            // folders are open. Cancellation (multi-root dismiss) throws
            // CancellationError on its own.
            throw new Error(this.ctx.code.l10n.t('Open a folder in VS Code to deploy a project as a Function App.'));
        }
        return { iacFolder: folder.uri } as Partial<TContext>;
    }
}

