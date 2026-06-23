/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getAuthProviderId, getConfiguredAzureEnv } from '@microsoft/vscode-azure-azutils';
import { ICodeContext, Roots } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../services';
import type { ManagedCommand } from './ManagedCommand';

/**
 * Explicitly signs the user in to Azure.
 *
 * Listing accounts is non-interactive (the resources tree uses
 * `getAccounts`, which never prompts), so when the user is signed out of
 * every account nothing triggers VS Code's sign-in flow. This command
 * forces an interactive sign-in via `getSession({ createIfNone: true })`
 * for the currently configured cloud, then invalidates the resources tree
 * so the freshly added account appears.
 */
@injectable()
export class SignIn implements ManagedCommand {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
    ) { }

    /** @inheritdoc */
    public async execute(): Promise<void> {
        const environment = getConfiguredAzureEnv(this.ctx.code);
        const scopes = [environment.resourceManagerDefaultScope];

        // `createIfNone: true` resolves to a session or rejects if the user
        // cancels, so a returned session always means a successful sign-in.
        await this.ctx.code.authentication.getSession(getAuthProviderId(environment), scopes, { createIfNone: true });
        this.cache.invalidate(Roots);
    }
}
