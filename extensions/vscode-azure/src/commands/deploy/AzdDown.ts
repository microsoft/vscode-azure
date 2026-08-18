/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { bySubscription } from '@microsoft/vscode-azure-azutils';
import { Everything, ICodeContext, IOutputChannel, showMessage, Wizard } from '@microsoft/vscode-azure-utils';
import { Container, inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { AzdDownStep } from '../../azd/wizard/AzdDownStep';
import type { AzdWizardContext } from '../../azd/wizard/AzdWizardContext';
import { SelectIacFolderStep } from '../../azd/wizard/SelectIacFolderStep';
import { IAzureViewDataTree } from '../../services';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Options accepted by {@linkcode AzdDown.execute} as its second argument.
 */
export interface AzdDownOptions {
    /**
     * When `true`, skip the destructive-action confirmation prompt and
     * proceed straight to teardown.
     *
     * Intended for automated callers (e.g. E2E tests) running in a headless
     * host where the modal confirmation dialog cannot be answered. Leave
     * unset for interactive use so users are always asked to confirm.
     */
    readonly skipConfirmation?: boolean;
}

/**
 * Runs `azd down --force --purge` in a visible terminal, deleting all
 * resources provisioned for the project's default azd environment.
 *
 * Prompts for explicit confirmation before doing anything, since the
 * operation is destructive and irreversible. The prompt can be bypassed
 * by passing {@linkcode AzdDownOptions.skipConfirmation}.
 *
 * Accessible from the command palette (searches the workspace for
 * `azure.yaml` or `azure.yml`) or by right-clicking an `azure.yaml`
 * / `azure.yml` file in the explorer.
 */
@injectable()
export class AzdDown implements ManagedCommand {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
        @inject(Container) private readonly container: Container,
    ) { }

    /** @inheritdoc */
    public async execute(fileUri?: vscode.Uri, options?: AzdDownOptions): Promise<void> {
        // Pre-seed iacFolder when invoked from a right-click on azure.yaml
        const iacFolder = fileUri ? this.ctx.code.Uri.joinPath(fileUri, '..') : undefined;

        // Destructive, irreversible operation -- require explicit confirmation
        // unless the caller has opted out (e.g. a headless E2E host).
        if (!options?.skipConfirmation) {
            const deleteLabel = this.ctx.code.l10n.t('Delete');
            await showMessage(
                this.ctx.code,
                this.ctx.code.l10n.t('Are you sure you want to delete all resources provisioned for this project\'s default environment? This cannot be undone.'),
                { modal: true, severity: 'warning', stepName: this.constructor.name },
                deleteLabel,
            );
        }

        const get = this.container.get.bind(this.container);

        const wizard = new Wizard<AzdWizardContext>(
            this.output,
            {
                iacFolder,
            },
            [
                get(SelectIacFolderStep),
            ],
            [
                get(AzdDownStep),
            ],
        );

        const context = await wizard.run();

        const subscriptionId = context.subscription?.subscriptionId ?? context.hydratedSubscriptionId;
        this.dataTree.invalidate(subscriptionId ? bySubscription(subscriptionId) : Everything);
    }
}
