/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    EventEmitter, IActionExecutor, Roots,
    type DataProvider, type DataProviderChangeEvent, type Disposable,
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
 * Fires {@linkcode onDidChange} when the index changes -- covering both new /
 * removed `host.json` files and workspace folder changes, which the index
 * watches on everyone's behalf.
 */
@injectable()
export class FunctionsWorkspaceDataProvider implements DataProvider<WorkspaceNode>, Disposable {
    public readonly isRoot = true;

    private readonly changeEmitter = new EventEmitter<DataProviderChangeEvent<WorkspaceNode>>();
    private readonly disposables: Disposable[] = [this.changeEmitter];

    public readonly onDidChange = this.changeEmitter.event;

    public constructor(
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IWorkspaceDataService) private readonly workspaceData: IWorkspaceDataService,
    ) {
        this.disposables.push(workspaceData.onDidChange(() => {
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

    /** @inheritdoc */
    public dispose(): void {
        this.disposables.forEach(d => void d.dispose());
    }
}
