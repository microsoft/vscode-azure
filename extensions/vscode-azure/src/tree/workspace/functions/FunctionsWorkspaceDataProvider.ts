/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    IActionExecutor, IVsCode,
    type DataProvider,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IWorkspaceIndexService } from '../../../utils/workspaceIndex/WorkspaceIndexService';
import type { WorkspaceDetector } from '../../../utils/workspaceIndex/WorkspaceDetector';
import { createTag, StandardTagNames } from '../../../utils/workspaceIndex/tags';
import type { FunctionsProjectNode, WorkspaceNode } from '../WorkspaceNode';
import { FunctionsProjectKeyPrefix, isFunctionsProjectNode } from '../WorkspaceNode';

/** File name that marks an Azure Functions project. */
const FunctionsHostFileName = 'host.json';

const functions = 'functions';

/** The `host.json` that marks an Azure Functions project. */
export const FunctionsHostFileTag = createTag(functions, StandardTagNames.projectFile);

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
    inspect(node) {
        if (!node.isDirectory && node.name === FunctionsHostFileName) {
            node.tag(FunctionsHostFileTag);
        }
    },
};

/** Data-layer provider for {@linkcode FunctionsProjectNode}s. */
@injectable()
export class FunctionsWorkspaceDataProvider implements DataProvider<WorkspaceNode> {
    public readonly isRoot = true;

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
        for (const uri of index.withTag(FunctionsHostFileTag)) {
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
}
