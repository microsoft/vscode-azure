/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, getWorkspaceFolder, type ICodeContext, PromptStep } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from './AzdWizardContext';
import type { TempProjectManager } from './TempProjectManager';

/**
 * Picks the {@linkcode AzdWizardContext.iacFolder iacFolder} based on
 * {@linkcode AzdWizardContext.job job}:
 *
 * - `createNew`: allocates a temp directory via {@linkcode TempProjectManager}.
 *   The workspace is never touched.
 * - `deploy`: prompts the user to pick a workspace folder (silent in
 *   single-root workspaces, shows a picker in multi-root). Throws
 *   {@linkcode CancellationError} if the user dismisses.
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
            // The user dismissed the folder picker -- treat as cancellation
            // to abort the wizard cleanly.
            throw new CancellationError();
        }
        return { iacFolder: folder.uri } as Partial<TContext>;
    }
}

