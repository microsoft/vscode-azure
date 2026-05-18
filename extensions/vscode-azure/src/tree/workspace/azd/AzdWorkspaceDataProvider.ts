/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    EventEmitter, IActionExecutor, IVsCode,
    type DataProvider, type DataProviderChangeEvent, type Disposable,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import type { AzdProjectNode, AzdServiceNode, WorkspaceNode } from '../WorkspaceNode';
import { isAzdProjectNode, isAzdServiceNode } from '../WorkspaceNode';
import { fileExists, getWorkspaceFolders } from '../workspaceFsUtils';

/** File names that mark an azd project. */
const AzureYamlFileNames = ['azure.yaml', 'azure.yml'] as const;

/**
 * Data-layer provider for {@linkcode AzdProjectNode}s and their
 * {@linkcode AzdServiceNode} children.
 *
 * Scans each open workspace folder for an `azure.yaml`/`azure.yml`
 * file (top-level only) and surfaces one project node per match.
 * The project's services are produced by parsing the yaml file with
 * the small, focused {@linkcode parseAzureYamlServices} helper -- we
 * intentionally do not shell out to `azd` here because root discovery
 * runs on every tree expansion and must stay fast.
 *
 * Fires {@linkcode onDidChange} when the set of workspace folders
 * changes so the tree re-discovers projects.
 */
@injectable()
export class AzdWorkspaceDataProvider implements DataProvider<AzdProjectNode | AzdServiceNode>, Disposable {
    public readonly isRoot = true;

    private readonly changeEmitter = new EventEmitter<DataProviderChangeEvent<AzdProjectNode | AzdServiceNode>>();
    private readonly disposables: Disposable[] = [this.changeEmitter];

    public readonly onDidChange = this.changeEmitter.event;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
    ) {
        this.disposables.push(code.workspace.onDidChangeWorkspaceFolders(() => {
            this.executor.output.debug('[data] azd workspace: folders changed');
            this.changeEmitter.fire({ resource: undefined, includeChildren: true });
        }));
    }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is AzdProjectNode | AzdServiceNode {
        return isAzdProjectNode(resource) || isAzdServiceNode(resource);
    }

    /** @inheritdoc */
    public async getChildren(resource?: WorkspaceNode): Promise<(AzdProjectNode | AzdServiceNode)[]> {
        if (!resource) {
            return this.discoverProjects();
        }
        if (isAzdProjectNode(resource)) {
            return this.getServices(resource);
        }
        return [];
    }

    /** Scan each workspace folder for `azure.yaml` / `azure.yml`. */
    private async discoverProjects(): Promise<AzdProjectNode[]> {
        const folders = getWorkspaceFolders(this.code);
        const projects: AzdProjectNode[] = [];
        for (const folder of folders) {
            const azureYamlUri = await this.findFirstExisting(folder.uri, AzureYamlFileNames);
            if (azureYamlUri) {
                projects.push({
                    id: `workspace://azdProject/${folder.uri.toString()}`,
                    type: 'azdProject',
                    label: folder.name,
                    resourceUri: folder.uri,
                    azureYamlUri,
                });
            }
        }
        this.executor.output.debug(`[data] azd workspace: discovered=${projects.length} of folders=${folders.length}`);
        return projects;
    }

    /**
     * Parse the project's `azure.yaml` and produce one {@linkcode AzdServiceNode}
     * per top-level service. Parsing errors are swallowed so a malformed
     * yaml shows zero services rather than blanking out the tree.
     */
    private async getServices(project: AzdProjectNode): Promise<AzdServiceNode[]> {
        let text: string;
        try {
            const bytes = await this.code.workspace.fs.readFile(project.azureYamlUri);
            text = Buffer.from(bytes).toString('utf8');
        } catch (e) {
            this.executor.output.debug(`[data] azd workspace: failed to read ${project.azureYamlUri.toString()}: ${(e as Error).message}`);
            return [];
        }

        const services = parseAzureYamlServices(text);
        this.executor.output.debug(`[data] azd workspace: ${project.resourceUri.toString()} services=${services.length}`);

        const result: AzdServiceNode[] = [];
        for (const { name, project: relativeProject } of services) {
            let resourceUri: vscode.Uri | undefined;
            if (relativeProject) {
                const candidate = this.code.Uri.joinPath(project.resourceUri, ...relativeProject.split(/[\\/]/).filter(Boolean));
                if (await fileExists(this.code, candidate)) {
                    resourceUri = candidate;
                }
            }
            result.push({
                id: `workspace://azdService/${project.resourceUri.toString()}/${name}`,
                type: 'azdService',
                label: name,
                serviceName: name,
                projectFolderUri: project.resourceUri,
                resourceUri,
            });
        }
        return result;
    }

    private async findFirstExisting(folder: vscode.Uri, names: readonly string[]): Promise<vscode.Uri | undefined> {
        for (const name of names) {
            const uri = this.code.Uri.joinPath(folder, name);
            if (await fileExists(this.code, uri)) {
                return uri;
            }
        }
        return undefined;
    }

    /** @inheritdoc */
    public dispose(): void {
        this.disposables.forEach(d => void d.dispose());
    }
}

/** A single entry parsed from the `services:` block of `azure.yaml`. */
interface ParsedAzdService {
    readonly name: string;
    readonly project?: string;
}

/**
 * Extract service entries from an `azure.yaml` text.
 *
 * This is an intentionally small, regex-based parser that handles the
 * common shape produced by `azd init` -- a top-level `services:` block
 * containing service-name keys, each of which may declare a `project:`
 * relative path. It does not handle quoting, flow-style YAML, anchors,
 * or comments inside string values. Anything fancier is left to a
 * proper `azd show` call in {@linkcode IAzdService.show}.
 *
 * Exported for unit testing.
 */
export function parseAzureYamlServices(text: string): ParsedAzdService[] {
    const lines = text.split(/\r?\n/);
    let inServices = false;
    let servicesIndent = -1;
    let currentName: string | undefined;
    let currentNameIndent = -1;
    let currentProject: string | undefined;
    const services: ParsedAzdService[] = [];

    const flush = () => {
        if (currentName) {
            services.push({ name: currentName, project: currentProject });
        }
        currentName = undefined;
        currentProject = undefined;
        currentNameIndent = -1;
    };

    for (const rawLine of lines) {
        // Strip comments (best effort -- ignores quoted '#')
        const noComment = rawLine.replace(/#.*$/, '');
        if (!noComment.trim()) {
            continue;
        }

        const indent = /^ */.exec(noComment)?.[0].length ?? 0;
        const content = noComment.trim();

        if (!inServices) {
            if (/^services\s*:\s*$/.test(content)) {
                inServices = true;
                servicesIndent = indent;
            }
            continue;
        }

        // Left the services block (back to top-level or shallower than services)
        if (indent <= servicesIndent) {
            flush();
            inServices = /^services\s*:\s*$/.test(content);
            servicesIndent = inServices ? indent : -1;
            continue;
        }

        // Service-name level (one indent step deeper than `services:`)
        if (currentNameIndent === -1 || indent <= currentNameIndent) {
            const nameMatch = /^([A-Za-z0-9_.-]+)\s*:/.exec(content);
            if (nameMatch) {
                flush();
                currentName = nameMatch[1];
                currentNameIndent = indent;
            }
            continue;
        }

        // Inside a service entry: look for `project: <value>`
        const projectMatch = /^project\s*:\s*(.+?)\s*$/.exec(content);
        if (projectMatch) {
            currentProject = stripQuotes(projectMatch[1]);
        }
    }

    flush();
    return services;
}

function stripQuotes(value: string): string {
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}
