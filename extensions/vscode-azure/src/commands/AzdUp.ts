/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { bySubscription } from '@microsoft/vscode-azure-azutils';
import { ICodeContext, IOutputChannel, Wizard, Everything } from '@microsoft/vscode-azure-utils';
import { Container, inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { AzdDeployStep } from '../azd/wizard/AzdDeployStep';
import { AzdProvisionStep } from '../azd/wizard/AzdProvisionStep';
import type { AzdWizardContext } from '../azd/wizard/AzdWizardContext';
import { SelectIacFolderStep } from '../azd/wizard/SelectIacFolderStep';
import { ShowEndpointUrlStep } from '../azd/wizard/ShowEndpointUrlStep';
import { IAzureViewDataTree } from '../services';
import type { ManagedCommand } from './ManagedCommand';

/**
 * Runs `azd provision` then `azd deploy` sequentially in visible
 * terminals, feeding the activity view with ARM deployment tracking
 * and code deployment progress.
 *
 * Accessible from the command palette (searches workspace for
 * `azure.yaml` or `azure.yml`) or by right-clicking an `azure.yaml`
 * / `azure.yml` file in the explorer.
 */
@injectable()
export class AzdUp implements ManagedCommand {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
        @inject(Container) private readonly container: Container,
    ) { }

    /** @inheritdoc */
    public async execute(fileUri?: vscode.Uri): Promise<void> {
        // Pre-seed iacFolder when invoked from a right-click on azure.yaml
        const iacFolder = fileUri ? this.ctx.code.Uri.joinPath(fileUri, '..') : undefined;

        const get = this.container.get.bind(this.container);

        const wizard = new Wizard<AzdWizardContext>(
            this.output,
            {
                iacFolder,
                provision: true,
                deploy: true,
            },
            [
                get(SelectIacFolderStep),
            ],
            [
                get(AzdProvisionStep),
                get(AzdDeployStep),
                get(ShowEndpointUrlStep),
            ],
        );

        const context = await wizard.run();

        const subscriptionId = context.subscription?.subscriptionId ?? context.hydratedSubscriptionId;
        this.dataTree.invalidate(subscriptionId ? bySubscription(subscriptionId) : Everything);
    }
}
