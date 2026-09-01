/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeContext, IOutputChannel, Wizard } from '@microsoft/vscode-azure-utils';
import { Container, inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { AzdPipelineConfigStep } from '../../azd/wizard/AzdPipelineConfigStep';
import type { AzdWizardContext } from '../../azd/wizard/AzdWizardContext';
import { SelectIacFolderStep } from '../../azd/wizard/SelectIacFolderStep';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Configures a CI/CD pipeline for an azd project by running
 * `azd pipeline config`.
 *
 * Accessible from the command palette (searches the workspace for `azure.yaml`
 * or `azure.yml`) or by right-clicking an `azure.yaml` / `azure.yml` file in
 * the explorer.
 */
@injectable()
export class ConfigureCicd implements ManagedCommand {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(Container) private readonly container: Container,
    ) { }

    /** @inheritdoc */
    public async execute(fileUri?: vscode.Uri): Promise<void> {
        // Pre-seed iacFolder when invoked from a right-click on azure.yaml
        const iacFolder = fileUri ? this.ctx.code.Uri.joinPath(fileUri, '..') : undefined;

        const get = this.container.get.bind(this.container);

        await new Wizard<AzdWizardContext>(
            this.output,
            { iacFolder },
            [
                get(SelectIacFolderStep),
            ],
            [
                get(AzdPipelineConfigStep),
            ],
        ).run();
    }
}
