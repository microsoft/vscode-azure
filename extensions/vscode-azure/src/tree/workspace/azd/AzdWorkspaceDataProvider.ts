/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    EventEmitter, IActionExecutor, IVsCode, fileExists,
    type DataProvider, type DataProviderChangeEvent, type Disposable,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { IAzdService } from '../../../azd/AzdService';
import type { WorkspaceDetector } from '../../../utils/workspaceIndex/WorkspaceDetector';
import { IWorkspaceIndexService } from '../../../utils/workspaceIndex/WorkspaceIndexService';
import { createTag, StandardTagNames } from '../../../utils/workspaceIndex/tags';
import type { AzdProjectNode, AzdServiceNode, WorkspaceNode } from '../WorkspaceNode';
import { AzdProjectKeyPrefix, AzdServiceKeyPrefix, isAzdProjectNode, isAzdServiceNode } from '../WorkspaceNode';

/** File names that mark an azd project. */
export const AzureYamlFileNames = ['azure.yaml', 'azure.yml'];

const azd = 'azd';

/** The `azure.yaml` / `azure.yml` file that marks an azd project. */
export const AzdProjectFile = createTag(azd, StandardTagNames.projectFile);

/** Tags the `azure.yaml` of every azd project. */
export const azdDetector: WorkspaceDetector = {
    id: 'azd',
    namespace: azd,
    files: { names: AzureYamlFileNames },
    inspect(node) { node.tag(AzdProjectFile); },
};

/**
 * Data-layer provider for {@linkcode AzdProjectNode}s and their
 * {@linkcode AzdServiceNode} children.
 *
 * Projects come from the shared workspace index rather than a private search,
 * so one walk serves every workspace provider. Invalidation is wired up once
 * for the whole tree in `registerTrees`, not per provider. Services are
 * enumerated by invoking {@linkcode IAzdService.show} (which shells out to
 * `azd show --output json`). Caching is handled by the surrounding
 * `DataItemTree` so `azd` is only re-invoked when the data layer's TTL expires
 * or an explicit invalidate fires.
 */
@injectable()
export class AzdWorkspaceDataProvider implements DataProvider<WorkspaceNode>, Disposable {
    public readonly isRoot = true;

    private readonly changeEmitter = new EventEmitter<DataProviderChangeEvent<WorkspaceNode>>();
    private readonly disposables: Disposable[] = [this.changeEmitter];

    public readonly onDidChange = this.changeEmitter.event;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(IWorkspaceIndexService) private readonly indexService: IWorkspaceIndexService,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is AzdProjectNode | AzdServiceNode {
        return isAzdProjectNode(resource) || isAzdServiceNode(resource);
    }

    /** @inheritdoc */
    public async getChildren(resource?: WorkspaceNode): Promise<(AzdProjectNode | AzdServiceNode)[]> {
        if (!resource) {
            return this.discoverProjects();
        } else if (isAzdProjectNode(resource)) {
            return this.getServices(resource);
        } else {
            return [];
        }
    }

    /**
     * Replace the initial folder-name label on an {@linkcode AzdProjectNode}
     * with the `name:` from `azure.yaml`, as reported by `azd show`. Runs
     * in the background after the node is loaded so the tree appears
     * immediately with the folder name and updates once `azd` responds.
     * Service nodes need no enrichment.
     *
     * @returns Always `false`; the project name is presentation-only and
     * does not affect the list of child services.
     */
    public async enrich(resource: AzdProjectNode | AzdServiceNode): Promise<boolean> {
        if (!isAzdProjectNode(resource)) {
            return false;
        }
        const projectFolder = this.code.Uri.joinPath(resource.resourceUri, '..');
        const show = await this.azd.show(projectFolder);
        if (show?.name) {
            Object.assign(resource, { label: show.name });
        }
        return false;
    }

    /** Discover azd projects from the shared workspace index. */
    private async discoverProjects(): Promise<AzdProjectNode[]> {
        const index = await this.indexService.getIndex();
        const projects: AzdProjectNode[] = [];
        for (const uri of index.withTag(AzdProjectFile)) {
            const folder = this.code.workspace.getWorkspaceFolder(uri);
            if (!folder) {
                continue;
            }
            projects.push({
                id: `${AzdProjectKeyPrefix}${uri.toString()}`,
                type: 'azdProject',
                label: folder.name,
                resourceUri: uri,
            });
        }
        this.executor.output.debug(`[data] azd workspace: discovered=${projects.length}`);
        return projects;
    }

    /**
     * Enumerate the project's services via {@linkcode IAzdService.show}.
     * Returns an empty list when `azd show` fails or reports no services,
     * so a broken or missing `azd` install shows zero services rather
     * than blanking out the tree.
     */
    private async getServices(project: AzdProjectNode): Promise<AzdServiceNode[]> {
        const projectFolder = this.code.Uri.joinPath(project.resourceUri, '..');
        const show = await this.azd.show(projectFolder);
        const servicesMap = show?.services ?? {};
        const serviceNames = Object.keys(servicesMap);
        this.executor.output.debug(`[data] azd workspace: ${project.resourceUri.toString()} services=${serviceNames.length}`);

        const result: AzdServiceNode[] = [];
        for (const name of serviceNames) {
            const descriptor = servicesMap[name];
            let projectFolderUri: vscode.Uri | undefined;
            if (descriptor.project?.path) {
                const candidate = this.code.Uri.file(descriptor.project.path);
                if (await fileExists(this.code, candidate)) {
                    projectFolderUri = candidate;
                }
            }
            result.push({
                id: `${AzdServiceKeyPrefix}${project.resourceUri.toString()}/${name}`,
                type: 'azdService',
                label: name,
                serviceName: name,
                resourceUri: project.resourceUri,
                projectFolderUri,
            });
        }
        return result;
    }

    /** @inheritdoc */
    public dispose(): void {
        this.disposables.forEach(d => void d.dispose());
    }
}
