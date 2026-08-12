/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    EventEmitter, IActionExecutor, Roots,
    type DataProvider, type DataProviderChangeEvent, type Disposable,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IWorkspaceIndexService } from '../../../utils/workspaceIndex/WorkspaceIndexService';
import type { FunctionsProjectNode, WorkspaceNode } from '../WorkspaceNode';
import { FunctionsProjectKeyPrefix, isFunctionsProjectNode } from '../WorkspaceNode';
import { FunctionsHostFile } from './functionsDetector';

/**
 * Data-layer provider for {@linkcode FunctionsProjectNode}s.
 *
 * Projects come from the shared workspace index rather than a private search,
 * so one walk serves every workspace provider and one watcher invalidates them
 * all. Function-app children inside the project (individual function trigger
 * definitions, deployed function apps, ...) are tracked by
 * https://github.com/microsoft/vscode-azure/issues/178.
 */
@injectable()
export class FunctionsWorkspaceDataProvider implements DataProvider<WorkspaceNode>, Disposable {
    public readonly isRoot = true;

    private readonly changeEmitter = new EventEmitter<DataProviderChangeEvent<WorkspaceNode>>();
    private readonly disposables: Disposable[] = [this.changeEmitter];

    public readonly onDidChange = this.changeEmitter.event;

    public constructor(
        @inject(IWorkspaceIndexService) private readonly indexService: IWorkspaceIndexService,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
    ) {
        this.disposables.push(indexService.onDidChangeIndex(() => {
            this.executor.output.debug('[data] functions workspace: index changed');
            this.changeEmitter.fire({ target: Roots });
        }));
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

    private async discoverProjects(): Promise<FunctionsProjectNode[]> {
        const index = await this.indexService.getIndex();
        // The tagged node is the `host.json` file, matching the `resourceUri`
        // this tree has always exposed to "Reveal in Explorer".
        const projects: FunctionsProjectNode[] = [];
        for (const hostFile of index.withTag(FunctionsHostFile)) {
            if (!hostFile.workspaceFolder) {
                continue;
            }
            projects.push({
                id: `${FunctionsProjectKeyPrefix}${hostFile.uri.toString()}`,
                type: 'functionsProject',
                label: hostFile.workspaceFolder.name,
                resourceUri: hostFile.uri,
            });
        }

        this.executor.output.debug(`[data] functions workspace: discovered=${projects.length}`);
        return projects;
    }

    /** @inheritdoc */
    public dispose(): void {
        this.disposables.forEach(d => void d.dispose());
    }
}
