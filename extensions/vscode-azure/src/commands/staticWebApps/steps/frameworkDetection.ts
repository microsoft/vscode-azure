/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import type { StaticWebAppAzdLanguage } from '../CreateStaticWebAppContext';
import type { StaticWebAppBuildPresetId } from '../buildPresets';

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

interface GitExtension {
    getAPI(version: 1): {
        readonly repositories: readonly {
            readonly rootUri: vscode.Uri;
            readonly state: {
                readonly HEAD?: { readonly name?: string };
                readonly remotes: readonly { readonly fetchUrl?: string; readonly pushUrl?: string }[];
            };
        }[];
    };
}

/** Reusable workspace signals consumed by creation now and local task generation later. */
export interface StaticWebAppProjectDetection {
    readonly frameworks: readonly StaticWebAppBuildPresetId[];
    readonly primaryPresetId?: StaticWebAppBuildPresetId;
    readonly appLocation?: string;
    readonly apiLocations: readonly string[];
    readonly angularProjectName?: string;
    readonly language?: StaticWebAppAzdLanguage;
    readonly repositoryUrl?: string;
    readonly branch?: string;
}

const excludedDirectories = new Set([
    '.git', '.next', '.output', '.svelte-kit', 'bin', 'build', 'coverage',
    'dist', 'node_modules', 'obj', 'out', 'public', 'target',
]);
const maximumScanDepth = 8;
const maximumFiles = 5000;

/**
 * Detects retained framework presets and Function API roots using only VS Code
 * workspace APIs.
 *
 * @remarks
 * The workspace walk below is Static Web Apps-specific by necessity: the
 * monorepo has no shared project-scanning service yet. Once the shared,
 * bounded workspace project detection service lands (see
 * https://github.com/microsoft/vscode-azure/issues/255), replace
 * {@linkcode scanWorkspace} and the exclusion/budget constants with that
 * service and keep only the Static Web Apps-specific preset mapping here.
 */
export async function detectStaticWebAppProject(
    code: IVsCode,
    workspaceRoot: vscode.Uri,
): Promise<StaticWebAppProjectDetection> {
    const files = await scanWorkspace(code, workspaceRoot);
    const packageFiles = files
        .filter(file => basename(file.relativePath).toLowerCase() === 'package.json')
        .sort(compareShallowFirst);

    const frameworks: StaticWebAppBuildPresetId[] = [];
    let primaryPresetId: StaticWebAppBuildPresetId | undefined;
    let appLocation: string | undefined;
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
                angularProjectName = await detectAngularProjectName(code, files, directory, packageJson);
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
            angularProjectName = await detectAngularProjectName(code, files, directory, undefined);
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

    const git = await detectGitMetadata(code, workspaceRoot);
    return {
        frameworks,
        primaryPresetId,
        appLocation,
        apiLocations: detectApiLocations(files),
        angularProjectName,
        language,
        ...git,
    };
}

async function scanWorkspace(code: IVsCode, root: vscode.Uri): Promise<ScannedFile[]> {
    const files: ScannedFile[] = [];
    const pending: { readonly uri: vscode.Uri; readonly relativePath: string; readonly depth: number }[] = [
        { uri: root, relativePath: '', depth: 0 },
    ];

    while (pending.length > 0 && files.length < maximumFiles) {
        const directory = pending.shift();
        if (!directory) {
            break;
        }
        let entries: [string, vscode.FileType][];
        try {
            entries = await code.workspace.fs.readDirectory(directory.uri);
        } catch (error) {
            if (isFileNotFound(error)) {
                continue;
            }
            throw error;
        }

        for (const [name, type] of entries) {
            const relativePath = directory.relativePath ? `${directory.relativePath}/${name}` : name;
            if (type === code.FileType.Directory) {
                if (directory.depth < maximumScanDepth && !excludedDirectories.has(name.toLowerCase())) {
                    pending.push({ uri: code.Uri.joinPath(directory.uri, name), relativePath, depth: directory.depth + 1 });
                }
            } else if (type === code.FileType.File) {
                files.push({ relativePath, uri: code.Uri.joinPath(directory.uri, name) });
            }
        }
    }
    return files;
}

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
    const source = await tryReadText(code, config.uri);
    return !!source && /\boutput\s*:\s*['"]export['"]/.test(source);
}

async function detectAngularProjectName(
    code: IVsCode,
    files: readonly ScannedFile[],
    directory: string,
    packageJson: PackageJson | undefined,
): Promise<string | undefined> {
    const angularFile = files.find(file => dirname(file.relativePath) === directory && basename(file.relativePath).toLowerCase() === 'angular.json');
    if (angularFile) {
        const angular = await tryReadJson<Record<string, unknown>>(code, angularFile.uri);
        if (typeof angular?.defaultProject === 'string') {
            return angular.defaultProject;
        }
        if (isRecord(angular?.projects)) {
            const firstProject = Object.keys(angular.projects)[0];
            if (firstProject) {
                return firstProject;
            }
        }
    }
    return typeof packageJson?.name === 'string' ? packageJson.name.replace(/^@[^/]+\//, '') : undefined;
}

async function findBlazorProject(code: IVsCode, files: readonly ScannedFile[]): Promise<ScannedFile | undefined> {
    const projects = files.filter(file => /\.csproj$/i.test(file.relativePath)).sort(compareShallowFirst);
    for (const project of projects) {
        const source = await tryReadText(code, project.uri);
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

async function detectGitMetadata(
    code: IVsCode,
    workspaceRoot: vscode.Uri,
): Promise<Pick<StaticWebAppProjectDetection, 'repositoryUrl' | 'branch'>> {
    const extension = code.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) {
        return {};
    }
    const git = extension.isActive ? extension.exports : await extension.activate();
    const rootPath = workspaceRoot.path.replace(/\/$/, '');
    const repositories = git.getAPI(1).repositories
        .filter(candidate => rootPath === candidate.rootUri.path.replace(/\/$/, '')
            || rootPath.startsWith(`${candidate.rootUri.path.replace(/\/$/, '')}/`))
        .sort((left, right) => right.rootUri.path.length - left.rootUri.path.length);
    if (repositories.length === 0) {
        return {};
    }
    const repository = repositories[0];
    const remote = repository.state.remotes.find(candidate => candidate.fetchUrl || candidate.pushUrl);
    return {
        repositoryUrl: remote?.fetchUrl ?? remote?.pushUrl,
        branch: repository.state.HEAD?.name,
    };
}

function hasDependency(packageJson: PackageJson, name: string): boolean {
    return (isRecord(packageJson.dependencies) && typeof packageJson.dependencies[name] === 'string')
        || (isRecord(packageJson.devDependencies) && typeof packageJson.devDependencies[name] === 'string');
}

function hasFile(files: readonly ScannedFile[], directory: string, name: string): boolean {
    return files.some(file => dirname(file.relativePath) === directory && basename(file.relativePath).toLowerCase() === name.toLowerCase());
}

async function tryReadJson<T>(code: IVsCode, uri: vscode.Uri): Promise<T | undefined> {
    const text = await tryReadText(code, uri);
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

async function tryReadText(code: IVsCode, uri: vscode.Uri): Promise<string | undefined> {
    try {
        return new TextDecoder().decode(await code.workspace.fs.readFile(uri));
    } catch (error) {
        if (isFileNotFound(error)) {
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

function isFileNotFound(error: unknown): error is { readonly code: 'FileNotFound' } {
    return !!error && typeof error === 'object' && 'code' in error && error.code === 'FileNotFound';
}
