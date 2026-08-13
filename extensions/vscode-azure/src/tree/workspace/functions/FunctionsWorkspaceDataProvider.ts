/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    IActionExecutor,
    type DataProvider,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { FunctionsProjectTag } from '../../../workspace/detectors/functionsProjectDetector';
import { IWorkspaceDataService } from '../../../workspace/WorkspaceDataService';
import { getTagMetadata } from '../../../workspace/WorkspaceEntry';
import type { FunctionsProjectNode, WorkspaceNode } from '../WorkspaceNode';
import { FunctionsProjectKeyPrefix, isFunctionsProjectNode } from '../WorkspaceNode';

/**
 * Data-layer provider for {@linkcode FunctionsProjectNode}s.
 *
 * Projects come from the shared workspace index rather than a private search:
 * {@linkcode FunctionsProjectTag} is contributed by the Functions detector, so
 * discovery is scanned once and shared with wizards and any other consumer.
 * Function-app children inside the project (individual function trigger
 * definitions, deployed function apps, ...) are out of scope for this initial
 * pass.
 *
 * This provider has no {@linkcode DataProvider.onDidChange}: index changes
 * refresh the workspace tree through the single subscription in `registerTrees`,
 * so that one file change refreshes the tree once rather than once per provider
 * reading from the index.
 */
@injectable()
export class FunctionsWorkspaceDataProvider implements DataProvider<WorkspaceNode> {
    public readonly isRoot = true;

    public constructor(
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IWorkspaceDataService) private readonly workspaceData: IWorkspaceDataService,
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

    // Showing the individual functions under a project is tracked by https://github.com/microsoft/vscode-azure/issues/178
    private async discoverProjects(): Promise<FunctionsProjectNode[]> {
        const entries = await this.workspaceData.getEntries(FunctionsProjectTag);
        const projects: FunctionsProjectNode[] = [];
        for (const entry of entries) {
            // The node is keyed and revealed by the `host.json` itself, which the
            // tag carries as metadata; the entry is the containing folder.
            const hostJsonUri = getTagMetadata(entry, FunctionsProjectTag)?.manifestUri;
            if (hostJsonUri) {
                projects.push({
                    id: `${FunctionsProjectKeyPrefix}${hostJsonUri.toString()}`,
                    type: 'functionsProject',
                    label: entry.folder.name,
                    resourceUri: hostJsonUri,
                });
            }
        }
        this.executor.output.debug(`[data] functions workspace: discovered=${projects.length}`);
        return projects;
    }
}
