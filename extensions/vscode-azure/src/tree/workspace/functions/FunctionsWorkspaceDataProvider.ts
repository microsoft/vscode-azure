/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Disposable, EventEmitter, IActionExecutor, IVsCode,
    type DataProvider, type DataProviderChangeEvent,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IWorkspaceIndexService } from '../../../utils/workspaceIndex/WorkspaceIndexService';
import type { WorkspaceDetector } from '../../../utils/workspaceIndex/WorkspaceDetector';
import { createTag, StandardTagNames } from '../../../utils/workspaceIndex/tags';
import type { FunctionsProjectNode, WorkspaceNode } from '../WorkspaceNode';
import { FunctionsProjectKeyPrefix, isFunctionsProjectNode } from '../WorkspaceNode';

/** File name that marks an Azure Functions project. */
export const FunctionsHostFileName = 'host.json';

const functions = 'functions';

/** The `host.json` that marks an Azure Functions project. */
export const FunctionsHostFile = createTag(functions, StandardTagNames.projectFile);

/**
 * Tags the `host.json` of every Azure Functions project.
 *
 * Listing the individual functions inside a project is tracked by
 * https://github.com/microsoft/vscode-azure/issues/178; it fits here as a
 * further tag applied to the project's source files.
 */
export const functionsDetector: WorkspaceDetector = {
    id: 'functions',
    namespace: functions,
    files: { names: [FunctionsHostFileName] },
    inspect(node) { node.tag(FunctionsHostFile); },
};

/**
 * Data-layer provider for {@linkcode FunctionsProjectNode}s.
 *
 * Projects come from the shared workspace index rather than a private search,
 * so one walk serves every workspace provider. Invalidation is wired up once
 * for the whole tree in `registerTrees`, not per provider. Function-app
 * children inside the project (individual function trigger definitions,
 * deployed function apps, ...) are tracked by
 * https://github.com/microsoft/vscode-azure/issues/178.
 */
@injectable()
export class FunctionsWorkspaceDataProvider implements DataProvider<WorkspaceNode>, Disposable {
    public readonly isRoot = true;

    private readonly changeEmitter = new EventEmitter<DataProviderChangeEvent<WorkspaceNode>>();
    private readonly disposables: Disposable[] = [this.changeEmitter];

    public readonly onDidChange = this.changeEmitter.event;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IWorkspaceIndexService) private readonly indexService: IWorkspaceIndexService,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
    ) { }

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
        for (const uri of index.withTag(FunctionsHostFile)) {
            const folder = this.code.workspace.getWorkspaceFolder(uri);
            if (!folder) {
                continue;
            }
            projects.push({
                id: `${FunctionsProjectKeyPrefix}${uri.toString()}`,
                type: 'functionsProject',
                label: folder.name,
                resourceUri: uri,
            });
        }

        this.executor.output.debug(`[data] functions workspace: discovered=${projects.length}`);
        return projects;
    }

    /** @inheritdoc */
    public dispose(): void {
        Disposable.disposeAll(this.disposables);
    }
}
