/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Disposable, EventEmitter, IActionExecutor, IVsCode, Roots,
    type DataProvider, type DataProviderChangeEvent,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { FunctionsProjectNode, WorkspaceNode } from '../WorkspaceNode';
import { FunctionsProjectKeyPrefix, isFunctionsProjectNode } from '../WorkspaceNode';

/** File name that marks an Azure Functions project. */
const FunctionsHostFileName = 'host.json';

/**
 * Data-layer provider for {@linkcode FunctionsProjectNode}s.
 *
 * Searches for a {@linkcode FunctionsHostFileName host.json}
 * across all open workspace folders via
 * {@linkcode vscode.workspace.findFiles findFiles}, then maps each
 * result to its containing workspace folder. Function-app children inside
 * the project (individual function trigger definitions, deployed
 * function apps, ...) are out of scope for this initial pass --
 * future work can add an `enrich` step or a child provider.
 *
 * Fires {@linkcode onDidChange} when the set of workspace folders
 * changes so the tree re-discovers projects.
 */
@injectable()
export class FunctionsWorkspaceDataProvider implements DataProvider<WorkspaceNode>, Disposable {
    public readonly isRoot = true;

    private readonly changeEmitter = new EventEmitter<DataProviderChangeEvent<WorkspaceNode>>();
    private readonly disposables: Disposable[] = [this.changeEmitter];

    public readonly onDidChange = this.changeEmitter.event;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
    ) {
        const invalidateRoots = (reason: string) => {
            this.executor.output.debug(`[data] functions workspace: ${reason}`);
            this.changeEmitter.fire({ target: Roots });
        };

        this.disposables.push(code.workspace.onDidChangeWorkspaceFolders(() => { invalidateRoots('folders changed'); }));

        const watcher = code.workspace.createFileSystemWatcher(FunctionsHostFileName);
        this.disposables.push(
            watcher,
            watcher.onDidCreate(() => { invalidateRoots('host.json created'); }),
            watcher.onDidChange(() => { invalidateRoots('host.json changed'); }),
            watcher.onDidDelete(() => { invalidateRoots('host.json deleted'); }),
        );
    }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is FunctionsProjectNode {
        return isFunctionsProjectNode(resource);
    }

    /** @inheritdoc */
    public async getChildren(resource?: WorkspaceNode): Promise<FunctionsProjectNode[]> {
        if (!resource) {
            return this.discoverProjects();
        } else {
            return [];
        }
    }

    // Showing the individual functions under a project is tracked by https://github.com/microsoft/vscode-azure/issues/178
    private async discoverProjects(): Promise<FunctionsProjectNode[]> {
        const hostJsons = await this.code.workspace.findFiles(FunctionsHostFileName, undefined, 5);
        const projects: FunctionsProjectNode[] = [];
        for (const uri of hostJsons) {
            const folder = this.code.workspace.getWorkspaceFolder(uri);
            if (folder) {
                projects.push({
                    id: `${FunctionsProjectKeyPrefix}${uri.toString()}`,
                    type: 'functionsProject',
                    label: folder.name,
                    resourceUri: uri,
                });
            }
        }
        this.executor.output.debug(`[data] functions workspace: discovered=${projects.length}`);
        return projects;
    }

    /** @inheritdoc */
    public dispose(): void {
        Disposable.disposeAll(this.disposables);
    }
}
