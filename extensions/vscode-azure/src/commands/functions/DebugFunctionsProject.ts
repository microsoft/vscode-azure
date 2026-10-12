/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { FunctionsProjectSelector } from '../../functions/FunctionsProjectSelector';
import { FunctionsDebugProvider } from '../../functions/debug/FunctionsDebugProvider';
import type { ManagedCommand } from '../ManagedCommand';

/** Starts the same product debug provider used by F5, targeting the selected project. */
@injectable()
export class DebugFunctionsProject implements ManagedCommand {
    public static readonly ContextValue = 'debugFunctionsProject';
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(FunctionsProjectSelector) private readonly projects: FunctionsProjectSelector,
    ) { }

    public async execute(target?: string | vscode.Uri): Promise<void> {
        const project = await this.projects.select(undefined, target);
        await this.code.debug.startDebugging(this.code.workspace.getWorkspaceFolder(project), {
            type: FunctionsDebugProvider.Type, request: 'launch',
            name: this.code.l10n.t('Debug Azure Functions'), projectPath: project.fsPath,
        });
    }
}
