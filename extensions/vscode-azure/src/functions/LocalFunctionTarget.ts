/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFunctionsHostClientProvider, type IFunctionsHostClient } from '@microsoft/vscode-azure-azutils';
import { dirname, ExternalError, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IWorkspaceViewDataTree } from '../services';
import { FunctionsProjectKeyPrefix, isLocalFunctionNode, type LocalFunctionNode } from '../tree/workspace/WorkspaceNode';
import { LocalFunctionSettings } from './LocalFunctionSettings';
import { LocalFunctionsHostTracker } from './host/LocalFunctionsHostTracker';

/** Local command resolution shared by the remote/local Functions command aliases. */
@injectable()
export class LocalFunctionTarget {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IWorkspaceViewDataTree) private readonly tree: IWorkspaceViewDataTree,
        @inject(LocalFunctionsHostTracker) private readonly hosts: LocalFunctionsHostTracker,
        @inject(IFunctionsHostClientProvider) private readonly createHost: IFunctionsHostClientProvider,
        @inject(LocalFunctionSettings) private readonly settings: LocalFunctionSettings,
    ) { }

    /** Returns only valid local function targets; remote keys are left to ResourceSelector. */
    public resolve(key?: string): LocalFunctionNode | undefined {
        const node = key ? this.tree.get(key) : undefined;
        if (isLocalFunctionNode(node)) {
            return node;
        }
        if (key?.startsWith(FunctionsProjectKeyPrefix)) {
            throw new ExternalError(this.code.l10n.t('The local function is not available. Refresh the workspace view.'));
        }
        return undefined;
    }

    /** Resolves the actual registered port, never a guessed default or a cached host URL. */
    public host(fn: LocalFunctionNode): { readonly client: IFunctionsHostClient; readonly port: number } {
        const host = this.hosts.get(dirname(fn.project.resourceUri));
        if (!host) {
            throw new ExternalError(this.code.l10n.t('Start debugging this Functions project before executing a function or copying its URL.'));
        }
        return { client: this.createHost({ port: host.port }), port: host.port };
    }

    /** Edits only the local disable flag and refreshes the owning project after a successful write. */
    public async setDisabled(fn: LocalFunctionNode, disabled: boolean): Promise<void> {
        await this.settings.setDisabled(dirname(fn.project.resourceUri), fn.functionName, disabled);
        this.tree.invalidate(fn.project);
        void this.code.window.showInformationMessage(this.code.l10n.t('Function settings updated. Restart the local host to apply the change.'));
    }
}
