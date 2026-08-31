/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readText, relativePath, type IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import type { StaticWebAppAzdLanguage } from '../CreateStaticWebAppContext';
import type { IWorkspaceIndexService } from '../../../utils/workspaceIndex/WorkspaceIndexService';
import type { WorkspaceDetector } from '../../../utils/workspaceIndex/WorkspaceDetector';
import { createTag, StandardTagNames } from '../../../utils/workspaceIndex/tags';
import { walkDirectory } from '../../../utils/workspaceIndex/walkWorkspace';
import type { StaticWebAppBuildPresetId } from '../buildPresets';

const staticWebAppsProject = 'staticWebAppsProject';
const StaticWebAppProjectFileTag = createTag(staticWebAppsProject, StandardTagNames.projectFile);
const projectFilePattern = /^(?:package\.json|angular\.json|tsconfig\.json|host\.json|index\.html|(?:next|vite)\.config\.[cm]?[jt]s|(?:hugo|config)\.(?:toml|ya?ml|json)|.+\.csproj)$/i;

interface ScannedFile {
    readonly relativePath: string;
    readonly uri: vscode.Uri;
}

interface PackageJson {
    readonly name?: unknown;
    readonly dependencies?: unknown;
    readonly devDependencies?: unknown;
    readonly scripts?: unknown;
}

/** Tags files that contribute to Static Web Apps framework and API detection. */
export const staticWebAppProjectDetector: WorkspaceDetector = {
    id: 'staticWebAppsProject',
    namespace: staticWebAppsProject,
    inspect(node) {
        if (!node.isDirectory && projectFilePattern.test(node.name)) {
            node.tag(StaticWebAppProjectFileTag);
        }
    },
};

/** Reusable workspace signals consumed by creation now and local task generation later. */
export interface StaticWebAppProjectDetection {
    readonly frameworks: readonly StaticWebAppBuildPresetId[];
    readonly primaryPresetId?: StaticWebAppBuildPresetId;
    readonly appLocation?: string;
    readonly apiLocations: readonly string[];
    /**
     * The build output directory read from the project's own build configuration.
     *
     * Only set when a configuration file states it, so an absent value means the preset's
     * conventional output is still the best guess rather than a known-correct answer.
     */
    readonly outputLocation?: string;
    readonly angularProjectName?: string;
    readonly language?: StaticWebAppAzdLanguage;
}

/**
 * Detects retained framework presets and Function API roots from the shared
 * workspace index.
 *
 * @remarks
 * The index is shared across products and kept fresh by one watcher. Results
 * are narrowed to {@linkcode workspaceRoot}, so monorepo services do not see
 * each other's signals. Project roots outside the open workspace are scanned
 * on demand because the shared index cannot cover them.
 */
export async function detectStaticWebAppProject(
    code: IVsCode,
    indexService: IWorkspaceIndexService,
    workspaceRoot: vscode.Uri,
): Promise<StaticWebAppProjectDetection> {
    const files = await getProjectFiles(code, indexService, workspaceRoot);
    const packageFiles = files
        .filter(file => basename(file.relativePath).toLowerCase() === 'package.json')
        .sort(compareShallowFirst);

    const frameworks: StaticWebAppBuildPresetId[] = [];
    let primaryPresetId: StaticWebAppBuildPresetId | undefined;
    let appLocation: string | undefined;
    let outputLocation: string | undefined;
    let angularProjectName: string | undefined;
    let language: StaticWebAppAzdLanguage | undefined;

    for (const packageFile of packageFiles) {
        const packageJson = await tryReadJson<PackageJson>(code, packageFile.uri);
        if (!packageJson) {
            continue;
        }
        const packageFrameworks = await detectPackageFrameworks(code, files, packageFile, packageJson);
        for (const framework of packageFrameworks) {
            if (!frameworks.includes(framework)) {
                frameworks.push(framework);
            }
        }
        if (!primaryPresetId && packageFrameworks.length > 0) {
            primaryPresetId = packageFrameworks[0];
            const directory = dirname(packageFile.relativePath);
            appLocation = toAppLocation(directory);
            language = hasFile(files, directory, 'tsconfig.json') || hasDependency(packageJson, 'typescript') ? 'ts' : 'js';
            if (primaryPresetId === 'angular') {
                const angular = await detectAngularProject(code, files, directory, packageJson);
                angularProjectName = angular.projectName;
                outputLocation = angular.outputLocation;
            } else if (isBundlerDrivenPreset(primaryPresetId) && usesVite(files, directory, packageJson)) {
                outputLocation = ViteDefaultOutputLocation;
            }
        }
    }

    if (!primaryPresetId) {
        const angularFile = files.find(file => basename(file.relativePath).toLowerCase() === 'angular.json');
        if (angularFile) {
            primaryPresetId = 'angular';
            frameworks.push('angular');
            const directory = dirname(angularFile.relativePath);
            appLocation = toAppLocation(directory);
            const angular = await detectAngularProject(code, files, directory, undefined);
            angularProjectName = angular.projectName;
            outputLocation = angular.outputLocation;
            language = hasFile(files, directory, 'tsconfig.json') ? 'ts' : 'js';
        }
    }

    if (!primaryPresetId) {
        const blazorProject = await findBlazorProject(code, files);
        if (blazorProject) {
            primaryPresetId = 'blazor';
            frameworks.push('blazor');
            appLocation = toAppLocation(dirname(blazorProject.relativePath));
            language = 'dotnet';
        }
    }

    if (!primaryPresetId) {
        const hugoFile = files.find(file => /(^|\/)(?:hugo|config)\.(?:toml|ya?ml|json)$/i.test(file.relativePath));
        if (hugoFile) {
            primaryPresetId = 'hugo';
            frameworks.push('hugo');
            appLocation = toAppLocation(dirname(hugoFile.relativePath));
        }
    }

    if (!primaryPresetId) {
        const indexFile = files.find(file => basename(file.relativePath).toLowerCase() === 'index.html');
        if (indexFile) {
            primaryPresetId = 'html';
            frameworks.push('html');
            appLocation = toAppLocation(dirname(indexFile.relativePath));
        }
    }

    return {
        frameworks,
        primaryPresetId,
        appLocation,
        apiLocations: detectApiLocations(files),
        outputLocation,
        angularProjectName,
        language,
    };
}
/**
 * Returns Static Web Apps project files beneath `root`.
 *
 * Open-workspace roots use the shared index. Other roots use the index
 * subsystem's bounded arbitrary-root walker.
 */
async function getProjectFiles(
    code: IVsCode,
    indexService: IWorkspaceIndexService,
    root: vscode.Uri,
): Promise<ScannedFile[]> {
    const isIndexedRoot = code.workspace.workspaceFolders?.some(
        folder => relativeProjectPath(folder.uri, root) !== undefined,
    ) ?? false;
    if (!isIndexedRoot) {
        return scanProjectFiles(code, root);
    }

    const index = await indexService.getIndex();
    const files: ScannedFile[] = [];

    for (const uri of index.withTag(StaticWebAppProjectFileTag)) {
        const path = relativeProjectPath(root, uri);
        if (path !== undefined) {
            files.push({
                relativePath: path,
                uri,
            });
        }
    }

    return files;
}

async function scanProjectFiles(code: IVsCode, root: vscode.Uri): Promise<ScannedFile[]> {
    const files: ScannedFile[] = [];
    for await (const directory of walkDirectory(code, root)) {
        for (const name of directory.fileNames) {
            if (projectFilePattern.test(name)) {
                const uri = code.Uri.joinPath(directory.uri, name);
                const path = relativeProjectPath(root, uri);
                if (path !== undefined) {
                    files.push({ relativePath: path, uri });
                }
            }
        }
    }
    return files;
}

function relativeProjectPath(root: vscode.Uri, uri: vscode.Uri): string | undefined {
    if (process.platform !== 'win32' || root.scheme !== 'file' || uri.scheme !== 'file') {
        return relativePath(root, uri);
    }

    const rootPath = root.path.replace(/\/+$/, '');
    if (uri.path.localeCompare(rootPath, undefined, { sensitivity: 'accent' }) === 0) {
        return '';
    }
    const prefix = `${rootPath}/`;
    return uri.path.slice(0, prefix.length).localeCompare(prefix, undefined, { sensitivity: 'accent' }) === 0
        ? uri.path.slice(prefix.length)
        : undefined;
}

/**
 * Path of {@linkcode uri} relative to {@linkcode root}, or `''` for the root
 * itself. The walk only ever yields descendants of the root, so no `..`
 * result is possible.
 */
async function detectPackageFrameworks(
    code: IVsCode,
    files: readonly ScannedFile[],
    packageFile: ScannedFile,
    packageJson: PackageJson,
): Promise<StaticWebAppBuildPresetId[]> {
    const detected: StaticWebAppBuildPresetId[] = [];
    const directory = dirname(packageFile.relativePath);
    if (hasDependency(packageJson, 'next')) {
        detected.push(await isNextStaticExport(code, files, directory, packageJson) ? 'nextjs-export' : 'nextjs');
    }
    if (hasDependency(packageJson, '@sveltejs/kit')) {
        detected.push('svelte-kit');
    }
    if (hasDependency(packageJson, 'nuxt')) {
        detected.push('nuxt3');
    }
    if (hasDependency(packageJson, 'gatsby')) {
        detected.push('gatsby');
    }
    if (hasDependency(packageJson, 'vuepress')) {
        detected.push('vuepress');
    }
    if (hasDependency(packageJson, '@angular/core')) {
        detected.push('angular');
    }
    if (hasDependency(packageJson, 'react') && !detected.some(id => id === 'nextjs' || id === 'nextjs-export' || id === 'gatsby')) {
        detected.push('react');
    }
    if (hasDependency(packageJson, 'svelte') && !detected.includes('svelte-kit')) {
        detected.push('svelte');
    }
    if (hasDependency(packageJson, 'vue') && !detected.some(id => id === 'nuxt3' || id === 'vuepress')) {
        detected.push('vuejs');
    }
    return detected;
}

async function isNextStaticExport(
    code: IVsCode,
    files: readonly ScannedFile[],
    directory: string,
    packageJson: PackageJson,
): Promise<boolean> {
    const scripts = isRecord(packageJson.scripts) ? packageJson.scripts : {};
    if (Object.values(scripts).some(value => typeof value === 'string' && /\bnext\s+export\b/.test(value))) {
        return true;
    }
    const config = files.find(file => dirname(file.relativePath) === directory && /^next\.config\.(?:js|cjs|mjs|ts)$/i.test(basename(file.relativePath)));
    if (!config) {
        return false;
    }
    const source = await readText(code, config.uri);
    return !!source && /\boutput\s*:\s*['"]export['"]/.test(source);
}

/**
 * Reads the Angular workspace to resolve the build target this Static Web App deploys.
 *
 * Falls back to the package name when there is no `angular.json`, matching the project name
 * the Angular CLI would have used. {@linkcode StaticWebAppProjectDetection.outputLocation} is
 * left unset unless the workspace states an `outputPath`, so a default Angular layout still
 * falls through to the preset's conventional output.
 */
async function detectAngularProject(
    code: IVsCode,
    files: readonly ScannedFile[],
    directory: string,
    packageJson: PackageJson | undefined,
): Promise<{ projectName: string | undefined; outputLocation: string | undefined }> {
    const angularFile = files.find(file => dirname(file.relativePath) === directory && basename(file.relativePath).toLowerCase() === 'angular.json');
    if (angularFile) {
        const angular = await tryReadJson<Record<string, unknown>>(code, angularFile.uri);
        const projects = isRecord(angular?.projects) ? angular.projects : undefined;
        const projectName = typeof angular?.defaultProject === 'string'
            ? angular.defaultProject
            : projects && Object.keys(projects)[0];
        if (projectName) {
            const project = projects?.[projectName];
            return { projectName, outputLocation: readAngularOutputPath(project) };
        }
    }
    const fallbackName = typeof packageJson?.name === 'string' ? packageJson.name.replace(/^@[^/]+\//, '') : undefined;
    return { projectName: fallbackName, outputLocation: undefined };
}

/**
 * Pulls the build target's `outputPath` out of one Angular project entry.
 *
 * Workspaces name the target collection `architect` or `targets` depending on their age, and
 * newer schemas express the path as an object whose `base` carries the directory.
 */
function readAngularOutputPath(project: unknown): string | undefined {
    if (!isRecord(project)) {
        return undefined;
    }
    const targets = isRecord(project.architect) ? project.architect : isRecord(project.targets) ? project.targets : undefined;
    const build = isRecord(targets?.build) ? targets.build : undefined;
    const options = isRecord(build?.options) ? build.options : undefined;
    const outputPath = options?.outputPath;

    if (typeof outputPath === 'string') {
        return outputPath || undefined;
    }
    if (isRecord(outputPath) && typeof outputPath.base === 'string') {
        return outputPath.base || undefined;
    }
    return undefined;
}

/**
 * Whether the preset's conventional output reflects a bundler choice the project can change.
 *
 * These presets predate Vite and name the output of their original toolchain, so a Vite project
 * using one of them builds somewhere else entirely. Frameworks that own their output path are
 * deliberately absent: they run Vite too, but always emit where their own preset already says.
 */
function isBundlerDrivenPreset(presetId: StaticWebAppBuildPresetId): boolean {
    return presetId === 'react' || presetId === 'svelte' || presetId === 'vuejs';
}

/** Vite's own default for `build.outDir`, which the presets below predate. */
const ViteDefaultOutputLocation = 'dist';

function usesVite(files: readonly ScannedFile[], directory: string, packageJson: PackageJson): boolean {
    return hasDependency(packageJson, 'vite')
        || files.some(file => dirname(file.relativePath) === directory && /^vite\.config\.[cm]?[jt]s$/i.test(basename(file.relativePath)));
}

async function findBlazorProject(code: IVsCode, files: readonly ScannedFile[]): Promise<ScannedFile | undefined> {
    const projects = files.filter(file => /\.csproj$/i.test(file.relativePath)).sort(compareShallowFirst);
    for (const project of projects) {
        const source = await readText(code, project.uri);
        if (source && /Microsoft\.AspNetCore\.Components\.WebAssembly|Sdk="Microsoft\.NET\.Sdk\.BlazorWebAssembly"/i.test(source)) {
            return project;
        }
    }
    return undefined;
}

function detectApiLocations(files: readonly ScannedFile[]): string[] {
    const hostJsons = files
        .filter(file => basename(file.relativePath).toLowerCase() === 'host.json')
        .sort(compareShallowFirst);
    const root = hostJsons.find(file => file.relativePath.toLowerCase() === 'host.json');
    if (root) {
        return ['/'];
    }
    const shallow = hostJsons.filter(file => segments(file.relativePath).length === 2);
    if (shallow.length === 1) {
        return [dirname(shallow[0].relativePath)];
    }
    return [...shallow, ...hostJsons.filter(file => segments(file.relativePath).length > 2)]
        .map(file => dirname(file.relativePath));
}

function hasDependency(packageJson: PackageJson, name: string): boolean {
    return (isRecord(packageJson.dependencies) && typeof packageJson.dependencies[name] === 'string')
        || (isRecord(packageJson.devDependencies) && typeof packageJson.devDependencies[name] === 'string');
}

function hasFile(files: readonly ScannedFile[], directory: string, name: string): boolean {
    return files.some(file => dirname(file.relativePath) === directory && basename(file.relativePath).toLowerCase() === name.toLowerCase());
}

async function tryReadJson<T>(code: IVsCode, uri: vscode.Uri): Promise<T | undefined> {
    const text = await readText(code, uri);
    if (text === undefined) {
        return undefined;
    }
    try {
        return JSON.parse(text) as T;
    } catch (error) {
        if (error instanceof SyntaxError) {
            return undefined;
        }
        throw error;
    }
}

function compareShallowFirst(left: ScannedFile, right: ScannedFile): number {
    return segments(left.relativePath).length - segments(right.relativePath).length
        || left.relativePath.localeCompare(right.relativePath);
}

function toAppLocation(directory: string): string {
    return directory ? directory.replace(/\\/g, '/') : '/';
}

function basename(value: string): string {
    return value.replace(/\\/g, '/').split('/').pop() ?? value;
}

function dirname(value: string): string {
    const parts = segments(value);
    parts.pop();
    return parts.join('/');
}

function segments(value: string): string[] {
    return value.replace(/\\/g, '/').split('/').filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
