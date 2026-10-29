/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExternalError, type IVsCode } from '@microsoft/vscode-azure-utils';

/**
 * Rejects an operation that runs tools against, or changes, workspace content
 * while the workspace is untrusted.
 *
 * The extension declares limited support for untrusted workspaces, so VS Code
 * activates it in Restricted Mode and menu enablement alone cannot be relied on:
 * a command can still be invoked from the Command Palette, a keybinding, or
 * another extension. Every code path that executes a tool (for example `azd` or
 * `swa`, which run project hooks and build configuration) or writes into a
 * workspace folder calls this first, before prompting or spawning anything.
 * Operations that touch only Azure, or only the extension's own scratch
 * directories, must not call it.
 *
 * @throws {@linkcode ExternalError} when the workspace is not trusted.
 */
export function requireWorkspaceTrust(code: IVsCode): void {
    if (!code.workspace.isTrusted) {
        throw new ExternalError(code.l10n.t(
            'This action runs tools against files in your workspace, so it is unavailable in an untrusted workspace. Run "Workspaces: Manage Workspace Trust" to trust this workspace, then try again.',
        ));
    }
}
