/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExternalError, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { AzuriteEmulator, AzuriteExtensionId } from '../../emulators/AzuriteEmulator';
import { FunctionsDebugType } from '../../functions/debug/functionsDebug';
import { LocalFunctionsHostProcess } from '../../functions/host/LocalFunctionsHostProcess';
import { IWorkspaceViewDataTree } from '../../services';
import { EmulatorsGroupId, isEmulatorNode } from '../../tree/workspace/WorkspaceNode';
import type { ManagedCommand } from '../ManagedCommand';

/** Controls only emulator nodes resolved from the current workspace tree. */
@injectable()
export class ControlEmulator implements ManagedCommand {
    public static readonly StartContextValue = 'startEmulator';
    public static readonly StopContextValue = 'stopEmulator';
    public static readonly InstallContextValue = 'installEmulator';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IWorkspaceViewDataTree) private readonly tree: Pick<IWorkspaceViewDataTree, 'get' | 'invalidate'>,
        @inject(AzuriteEmulator) private readonly azurite: AzuriteEmulator,
        @inject(LocalFunctionsHostProcess) private readonly hosts: Pick<LocalFunctionsHostProcess, 'stopProject'>,
    ) { }

    public async execute(action: 'start' | 'stop' | 'install', key: string): Promise<void> {
        const node = this.tree.get(key);
        if (!isEmulatorNode(node)) {
            throw new ExternalError(this.code.l10n.t('The emulator is not available. Refresh the workspace view.'));
        }
        try {
            if (node.emulatorKind === 'azurite') {
                if (action === 'install') {
                    await this.code.commands.executeCommand('extension.open', AzuriteExtensionId);
                } else {
                    await this.azurite.control(action);
                }
            } else if (node.resourceUri && action !== 'install') {
                if (action === 'stop') {
                    await this.hosts.stopProject(node.resourceUri);
                } else {
                    const started = await this.code.debug.startDebugging(this.code.workspace.getWorkspaceFolder(node.resourceUri), {
                        type: FunctionsDebugType, request: 'launch',
                        name: this.code.l10n.t('Debug Azure Functions'), projectPath: node.resourceUri.fsPath,
                    });
                    if (!started) {
                        throw new ExternalError(this.code.l10n.t('Could not start the Functions host. See the debug console and host terminal for details.'));
                    }
                }
            } else {
                throw new ExternalError(this.code.l10n.t('This emulator action is not available.'));
            }
        } finally {
            this.tree.invalidate(EmulatorsGroupId);
        }
    }
}
