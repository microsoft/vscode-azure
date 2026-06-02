/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IWorkspaceViewDataTree } from '../services';
import { isAzdServiceNode, isWorkspaceNode } from '../tree/workspace/WorkspaceNode';
import type { ManagedCommand } from './ManagedCommand';

/**
 * Reveals the file or folder represented by a workspace tree node in
 * VS Code's built-in File Explorer view. No-op for nodes that do not
 * have an associated `resourceUri`.
 *
 * For {@linkcode AzdServiceNode}s the reveal target is the service's
 * {@linkcode AzdServiceNode.projectFolderUri projectFolderUri} rather
 * than the parent project's `azure.yaml`.
 *
 * Wired up as a context-menu command on workspace nodes whose
 * context value includes {@linkcode RevealInExplorer.ContextValue}.
 */
@injectable()
export class RevealInExplorer implements ManagedCommand {
    /** Context value gating this command's visibility in the tree view. */
    public static ContextValue = 'revealInExplorer';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IWorkspaceViewDataTree) private readonly dataTree: IWorkspaceViewDataTree,
    ) { }

    /** @inheritdoc */
    public async execute(key: string): Promise<void> {
        const node = this.dataTree.get(key);

        if (!isWorkspaceNode(node) || !node.resourceUri) {
            return;
        }

        const revealUri = isAzdServiceNode(node) && node.projectFolderUri
            ? node.projectFolderUri
            : node.resourceUri;

        await this.code.commands.executeCommand('revealInExplorer', revealUri);
    }
}
