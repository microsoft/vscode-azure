/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode, type DataProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { EmulatorNode, EmulatorsGroupNode, WorkspaceNode } from '../WorkspaceNode';
import { EmulatorKeyPrefix, EmulatorsGroupId, isEmulatorsGroupNode } from '../WorkspaceNode';

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
        if (typeof resource !== 'object' || resource === null) {
            return false;
        }
        const type = (resource as WorkspaceNode).type;
        return type === 'emulatorsGroup' || type === 'emulator';
    }

    /** @inheritdoc */
    public getChildren(resource?: WorkspaceNode): Promise<(EmulatorsGroupNode | EmulatorNode)[]> {
        if (!resource) {
            return Promise.resolve([this.buildGroup()]);
        }
        if (isEmulatorsGroupNode(resource)) {
            return Promise.resolve(this.getEmulators());
        }
        return Promise.resolve([]);
    }

    private buildGroup(): EmulatorsGroupNode {
        return {
            id: EmulatorsGroupId,
            type: 'emulatorsGroup',
            label: this.code.l10n.t('Emulators'),
        };
    }

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
