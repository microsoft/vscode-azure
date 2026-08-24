/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode, type DataProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { EmulatorNode, EmulatorsGroupNode, WorkspaceNode } from '../WorkspaceNode';
import { EmulatorKeyPrefix, EmulatorsGroupId, isEmulatorNode, isEmulatorsGroupNode } from '../WorkspaceNode';

/**
 * Data-layer provider for the local emulators section.
 *
 * Surfaces a single {@linkcode EmulatorsGroupNode} at the root and a
 * small static list of well-known emulator entries under it. Detection
 * (probing well-known ports, invoking `--version`, etc.) is left to
 * follow-up work -- the static list documents what we plan to support
 * and gives the user something to discover.
 */
@injectable()
export class EmulatorsWorkspaceDataProvider implements DataProvider<EmulatorsGroupNode | EmulatorNode> {
    public readonly isRoot = true;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is EmulatorsGroupNode | EmulatorNode {
        return isEmulatorsGroupNode(resource) || isEmulatorNode(resource);
    }

    /** @inheritdoc */
    public getChildren(resource?: WorkspaceNode): Promise<(EmulatorsGroupNode | EmulatorNode)[]> {
        if (!resource) {
            return Promise.resolve([this.buildGroupNode()]);
        } else if (isEmulatorsGroupNode(resource)) {
            return Promise.resolve(this.getEmulators());
        } else {
            return Promise.resolve([]);
        }
    }

    private buildGroupNode(): EmulatorsGroupNode {
        return {
            id: EmulatorsGroupId,
            type: 'emulatorsGroup',
            label: this.code.l10n.t('Emulators'),
        };
    }

    // Static placeholder data for now; detecting actual emulator availability is tracked by https://github.com/microsoft/vscode-azure/issues/176
    private getEmulators(): EmulatorNode[] {
        return [
            {
                id: `${EmulatorKeyPrefix}azurite`,
                type: 'emulator',
                label: this.code.l10n.t('Azurite (Storage)'),
                description: this.code.l10n.t('Not detected'),
            },
            {
                id: `${EmulatorKeyPrefix}functions`,
                type: 'emulator',
                label: this.code.l10n.t('Azure Functions Core Tools'),
                description: this.code.l10n.t('Not detected'),
            },
        ];
    }
}
