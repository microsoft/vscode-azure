/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { IWorkspaceProjectService } from '../workspace/WorkspaceProjectService';
import type { WorkspaceProject } from '../workspace/WorkspaceProject';

/** A file or folder selected relative to its containing workspace folder. */
export interface WorkspaceLocation {
    readonly uri: vscode.Uri;
    /** POSIX-style path relative to {@linkcode workspaceFolder}, or `.` for its root. */
    readonly relativePath: string;
    readonly workspaceFolder: vscode.WorkspaceFolder;
    /** Short summary of why this location was suggested, shown beside the path. */
    readonly description?: string;
}

/**
 * Supplies the suggestions offered by {@linkcode PickWorkspaceLocationStep}.
 *
 * A plain function, so a caller needing something the built-in sources do not
 * cover can pass its own without any new extension point.
 */
export type WorkspaceLocationSource =
    (token?: vscode.CancellationToken) => Promise<readonly WorkspaceLocation[]>;

/** Shapes the locations {@linkcode projectLocations} derives from a project. */
export interface ProjectLocationOptions {
    /** Restricts suggestions to matching projects. Defaults to all of them. */
    readonly filter?: (project: WorkspaceProject) => boolean;

    /**
     * Path within the project to offer instead of its root, e.g.
     * `project => project.outputDirectory` to pick a build output folder.
     * Returning `undefined` drops the project from the suggestions.
     */
    readonly subPath?: (project: WorkspaceProject) => string | undefined;
}

/**
 * Suggests locations from the projects detected in the workspace.
 *
 * Prefer this over scanning the workspace directly: detection already skips
 * generated, vendored, and `.gitignore`d paths, so suggestions do not include
 * build output or dependencies, and it labels each entry with the frameworks it
 * found.
 */
export function projectLocations(
    service: IWorkspaceProjectService,
    options: ProjectLocationOptions = {},
): WorkspaceLocationSource {
    return async token => {
        const projects = await service.getProjects(token);
        const locations: WorkspaceLocation[] = [];

        for (const project of projects) {
            if (options.filter && !options.filter(project)) {
                continue;
            }

            const subPath = options.subPath ? options.subPath(project) : undefined;
            if (options.subPath && subPath === undefined) {
                continue;
            }

            locations.push(toLocation(project, subPath));
        }

        return locations;
    };
}

function toLocation(project: WorkspaceProject, subPath: string | undefined): WorkspaceLocation {
    const relativePath = joinRelativePaths(project.relativePath, subPath);
    // `rootUri` is already the project root, so only the sub-path is appended.
    const uri = subPath && subPath !== '.'
        ? appendPath(project.rootUri, subPath)
        : project.rootUri;

    return {
        uri,
        relativePath,
        workspaceFolder: project.workspaceFolder,
        description: project.frameworks.length > 0 ? project.frameworks.join(', ') : undefined,
    };
}

function joinRelativePaths(root: string, subPath: string | undefined): string {
    if (!subPath || subPath === '.') {
        return root;
    }
    return root === '.' ? subPath : `${root}/${subPath}`;
}

/**
 * Appends a POSIX-style relative path to `uri`.
 *
 * Uses the URI's own `with`/`path` rather than `Uri.joinPath` so this module has
 * no value-side dependency on the `vscode` namespace.
 */
function appendPath(uri: vscode.Uri, relativePath: string): vscode.Uri {
    const base = uri.path.replace(/\/$/, '');
    return uri.with({ path: `${base}/${relativePath}` });
}
