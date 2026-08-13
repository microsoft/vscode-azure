/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    IActionExecutor, IVsCode, fileExists,
    type DataProvider,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { IAzdService } from '../../../azd/AzdService';
import { AzdProjectTag } from '../../../workspace/detectors/azdProjectDetector';
import { IWorkspaceDataService } from '../../../workspace/WorkspaceDataService';
import { getTagMetadata } from '../../../workspace/WorkspaceEntry';
import type { AzdProjectNode, AzdServiceNode, WorkspaceNode } from '../WorkspaceNode';
import { AzdProjectKeyPrefix, AzdServiceKeyPrefix, isAzdProjectNode, isAzdServiceNode } from '../WorkspaceNode';

/**
 * Data-layer provider for {@linkcode AzdProjectNode}s and their
 * {@linkcode AzdServiceNode} children.
 *
 * Projects come from the shared workspace index rather than a private search:
 * {@linkcode AzdProjectTag} is contributed by the azd detector, so discovery is
 * scanned once and shared with wizards and any other consumer. Services are
 * enumerated by invoking {@linkcode IAzdService.show} (which shells out to
 * `azd show --output json`); that stays here because it is expensive and only
 * needed when a project node is expanded. Caching is handled by the surrounding
 * `DataItemTree` so `azd` is only re-invoked when the data layer's TTL expires
 * or an explicit invalidate fires.
 *
 * This provider has no {@linkcode DataProvider.onDidChange}: index changes
 * refresh the workspace tree through the single subscription in `registerTrees`,
 * so that one file change refreshes the tree once rather than once per provider
 * reading from the index.
 */
@injectable()
export class AzdWorkspaceDataProvider implements DataProvider<WorkspaceNode> {
    public readonly isRoot = true;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(IWorkspaceDataService) private readonly workspaceData: IWorkspaceDataService,
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

    /**
     * Discover azd projects from the shared workspace index.
     */
    private async discoverProjects(): Promise<AzdProjectNode[]> {
        const entries = await this.workspaceData.getEntries(AzdProjectTag);
        const projects: AzdProjectNode[] = [];
        for (const entry of entries) {
            // The node is keyed and revealed by the `azure.yaml` itself, which
            // the tag carries as metadata; the entry is the containing folder.
            const azureYamlUri = getTagMetadata(entry, AzdProjectTag)?.manifestUri;
            if (azureYamlUri) {
                projects.push({
                    id: `${AzdProjectKeyPrefix}${azureYamlUri.toString()}`,
                    type: 'azdProject',
                    label: entry.folder.name,
                    resourceUri: azureYamlUri,
                });
            }
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
}
