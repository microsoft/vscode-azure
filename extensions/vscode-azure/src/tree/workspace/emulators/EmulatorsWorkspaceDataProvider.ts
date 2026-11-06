/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename, dirname, Disposable, EventEmitter, IVsCode, type DataProvider, type DataProviderChangeEvent } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { AzuriteEmulator } from '../../../emulators/AzuriteEmulator';
import { FunctionsHostFileTag } from '../../../functions/functionsDetector';
import { LocalFunctionsHostTracker } from '../../../functions/host/LocalFunctionsHostTracker';
import { IWorkspaceIndexService } from '../../../utils/workspaceIndex/WorkspaceIndexService';
import type { EmulatorNode, EmulatorsGroupNode, WorkspaceNode } from '../WorkspaceNode';
import { EmulatorKeyPrefix, EmulatorsGroupId, isEmulatorNode, isEmulatorsGroupNode } from '../WorkspaceNode';

/** Discovers configured Storage services and Functions hosts for indexed local projects. */
@injectable()
export class EmulatorsWorkspaceDataProvider implements DataProvider<WorkspaceNode>, Disposable {
    public readonly isRoot = true;
    private readonly changes = new EventEmitter<DataProviderChangeEvent<WorkspaceNode>>();
    public readonly onDidChange = this.changes.event;
    private readonly disposables: Disposable[];
    private readonly timer: ReturnType<typeof setInterval>;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(AzuriteEmulator) private readonly azurite: AzuriteEmulator,
        @inject(IWorkspaceIndexService) private readonly index: IWorkspaceIndexService,
        @inject(LocalFunctionsHostTracker) private readonly hosts: LocalFunctionsHostTracker,
    ) {
        const refresh = () => { this.changes.fire({ target: EmulatorsGroupId }); };
        this.disposables = [
            this.changes,
            hosts.onDidChange(refresh),
            code.extensions.onDidChange(refresh),
            code.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('azurite')) { refresh(); }
            }),
        ];
        this.timer = setInterval(refresh, 5000);
        this.timer.unref();
    }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is EmulatorsGroupNode | EmulatorNode {
        return isEmulatorsGroupNode(resource) || isEmulatorNode(resource);
    }

    /** @inheritdoc */
    public async getChildren(resource?: WorkspaceNode): Promise<WorkspaceNode[]> {
        if (!resource) {
            return [{ id: EmulatorsGroupId, type: 'emulatorsGroup', label: this.code.l10n.t('Emulators') }];
        }
        if (!isEmulatorsGroupNode(resource)) { return []; }
        const status = await this.azurite.status();
        const nodes: EmulatorNode[] = [{
            id: `${EmulatorKeyPrefix}azurite`, type: 'emulator', emulatorKind: 'azurite',
            label: this.code.l10n.t('Azurite (Storage)'),
            state: !status.installed ? 'notInstalled' : status.running === 3 ? 'running' : status.running ? 'partial' : 'stopped',
            description: !status.installed ? status.running
                ? this.code.l10n.t('Running externally; install Azurite for controls') : this.code.l10n.t('Not installed')
                : status.running === 3 ? this.code.l10n.t('Running')
                    : status.running ? this.code.l10n.t('{0}/3 services running', status.running)
                        : this.code.l10n.t('Stopped'),
        }];
        for (const hostJson of (await this.index.getIndex()).withTag(FunctionsHostFileTag)) {
            const project = dirname(hostJson);
            if (project.scheme !== 'file' || !this.code.workspace.getWorkspaceFolder(project)) { continue; }
            const host = this.hosts.get(project);
            nodes.push({
                id: `${EmulatorKeyPrefix}functions/${project.toString()}`, type: 'emulator', emulatorKind: 'functions',
                label: this.code.l10n.t('Functions: {0}', basename(project)), resourceUri: project,
                state: host ? 'running' : 'stopped',
                description: host ? this.code.l10n.t('Running on port {0}', host.port) : this.code.l10n.t('Stopped'),
            });
        }
        return nodes;
    }

    /** Releases refresh subscriptions; emulator processes remain with their lifecycle owners. */
    public dispose(): void {
        clearInterval(this.timer);
        Disposable.disposeAll(this.disposables);
    }
}
