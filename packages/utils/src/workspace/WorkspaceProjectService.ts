/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ignore, { type Ignore } from 'ignore';
import { matchesGlob } from 'node:path/posix';
import type * as vscode from 'vscode';
import { CancellationError } from '../vscode/CancellationError';
import type { IVsCode } from '../vscode/IVsCode';
import { defaultProjectDetectionRules } from './defaultProjectDetectionRules';
import {
    defaultWorkspaceScanBudgets,
    defaultWorkspaceScanCacheTtlMs,
    type IWorkspaceProjectService,
    type WorkspaceScanBudgets,
    type WorkspaceScanOptions,
} from './IWorkspaceProjectService';
import type {
    JsonProjectPredicate,
    ProjectDetectionRule,
    ProjectOutputRule,
    ProjectPredicate,
    ProjectRuleEmission,
} from './ProjectDetectionRule';
import type {
    ProjectDetection,
    ProjectDetectionEvidence,
    ProjectOutputDirectory,
    WorkspaceProject,
    WorkspaceScanDiagnostic,
    WorkspaceScanLimit,
    WorkspaceScanResult,
} from './WorkspaceProject';

interface CacheEntry {
    readonly expiresAt: number;
    readonly roots: readonly string[];
    readonly result: WorkspaceScanResult;
}

interface IgnoreScope {
    readonly path: string;
    readonly matcher: Ignore;
}

interface PendingDirectory {
    readonly uri: vscode.Uri;
    readonly relativePath: string;
    readonly depth: number;
    readonly ignoreScopes: readonly IgnoreScope[];
}

interface WorkspaceIndex {
    readonly workspaceFolder: vscode.WorkspaceFolder;
    readonly files: ReadonlyMap<string, vscode.Uri>;
    readonly candidateRoots: readonly string[];
    readonly reachedLimits: ReadonlySet<WorkspaceScanLimit>;
}

interface EvaluationContext {
    readonly code: IVsCode;
    readonly index: WorkspaceIndex;
    readonly rootPath: string;
    readonly rootUri: vscode.Uri;
    readonly budgets: WorkspaceScanBudgets;
    readonly token: vscode.CancellationToken | undefined;
    readonly diagnostics: WorkspaceScanDiagnostic[];
    readonly reachedLimits: Set<WorkspaceScanLimit>;
    readonly textCache: Map<string, Promise<string | undefined>>;
    readonly jsonCache: Map<string, Promise<unknown>>;
}

interface PredicateResult {
    readonly matched: boolean;
    readonly evidence?: ProjectDetectionEvidence;
}

const hardExcludedDirectories = new Set([
    '.git',
    '.next',
    '.output',
    '.svelte-kit',
    'bin',
    'build',
    'coverage',
    'dist',
    'node_modules',
    'obj',
    'out',
    'public',
    'target',
]);

/**
 * Workspace-API-only implementation of {@linkcode IWorkspaceProjectService}.
 *
 * Completed scans are cached briefly. The service does not create recursive
 * file-system watchers; callers that modify project files should invalidate it.
 */
export class WorkspaceProjectService implements IWorkspaceProjectService, vscode.Disposable {
    private readonly cache = new Map<string, CacheEntry>();
    private readonly workspaceFoldersSubscription: vscode.Disposable;

    public constructor(private readonly code: IVsCode) {
        this.workspaceFoldersSubscription = code.workspace.onDidChangeWorkspaceFolders(event => {
            for (const folder of [...event.added, ...event.removed]) {
                this.invalidate(folder.uri);
            }
        });
    }

    /** Releases the workspace-folder-change subscription and cached results. */
    public dispose(): void {
        this.workspaceFoldersSubscription.dispose();
        this.cache.clear();
    }

    /** @inheritdoc */
    public async scan(
        token?: vscode.CancellationToken,
        options: WorkspaceScanOptions = {},
    ): Promise<WorkspaceScanResult> {
        throwIfCanceled(token);

        const folders = options.workspaceFolders ?? this.code.workspace.workspaceFolders ?? [];
        const rules = validateAndSortRules([...defaultProjectDetectionRules, ...(options.additionalRules ?? [])]);
        const budgets = { ...defaultWorkspaceScanBudgets, ...options.budgets };
        validateBudgets(budgets);

        const key = createCacheKey(folders, rules, budgets);
        const cached = this.cache.get(key);
        if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
            return cached.result;
        }
        this.cache.delete(key);

        const diagnostics: WorkspaceScanDiagnostic[] = [];
        const reachedLimits = new Set<WorkspaceScanLimit>();
        const projects: WorkspaceProject[] = [];

        for (const folder of folders) {
            throwIfCanceled(token);
            const index = await this.scanWorkspaceFolder(folder, rules, budgets, token);
            for (const limit of index.reachedLimits) {
                reachedLimits.add(limit);
            }

            for (const rootPath of index.candidateRoots) {
                throwIfCanceled(token);
                const project = await evaluateProject(
                    this.code,
                    index,
                    rootPath,
                    rules,
                    budgets,
                    token,
                    diagnostics,
                    reachedLimits,
                );
                if (project) {
                    projects.push(project);
                }
            }
        }

        projects.sort(compareProjects);
        const filteredProjects = projects.filter(project =>
            !isNestedStaticHtmlFallback(project, projects));
        const result: WorkspaceScanResult = {
            projects: filteredProjects,
            diagnostics,
            truncated: reachedLimits.size > 0,
            reachedLimits: [...reachedLimits].sort(),
        };

        const ttl = options.cacheTtlMs ?? defaultWorkspaceScanCacheTtlMs;
        if (ttl > 0) {
            this.cache.set(key, {
                expiresAt: Date.now() + ttl,
                roots: folders.map(folder => folder.uri.toString()),
                result,
            });
        }
        return result;
    }

    /** @inheritdoc */
    public invalidate(root?: vscode.Uri): void {
        if (!root) {
            this.cache.clear();
            return;
        }

        const rootKey = root.toString();
        for (const [key, entry] of this.cache) {
            if (entry.roots.some(cachedRoot => uriContainsEither(cachedRoot, rootKey))) {
                this.cache.delete(key);
            }
        }
    }

    private async scanWorkspaceFolder(
        workspaceFolder: vscode.WorkspaceFolder,
        rules: readonly ProjectDetectionRule[],
        budgets: WorkspaceScanBudgets,
        token: vscode.CancellationToken | undefined,
    ): Promise<WorkspaceIndex> {
        const files = new Map<string, vscode.Uri>();
        const candidateRoots = new Set<string>();
        const reachedLimits = new Set<WorkspaceScanLimit>();
        const candidatePatterns = [...new Set(rules.flatMap(rule => rule.candidateFiles))];
        const pending: PendingDirectory[] = [{
            uri: workspaceFolder.uri,
            relativePath: '',
            depth: 0,
            ignoreScopes: [],
        }];
        let visitedEntries = 0;

        while (pending.length > 0 && visitedEntries < budgets.maxEntries) {
            throwIfCanceled(token);
            const directory = pending.shift();
            if (!directory) {
                break;
            }

            let entries: [string, vscode.FileType][];
            try {
                entries = await this.code.workspace.fs.readDirectory(directory.uri);
            } catch (error) {
                if (isFileNotFound(error)) {
                    continue;
                }
                throw error;
            }

            const scopes = await this.loadIgnoreScope(directory, entries, budgets, token, reachedLimits);
            entries.sort(([left], [right]) => left.localeCompare(right));

            for (const [name, type] of entries) {
                throwIfCanceled(token);
                if (visitedEntries >= budgets.maxEntries) {
                    reachedLimits.add('entries');
                    break;
                }
                visitedEntries++;

                const relativePath = joinPath(directory.relativePath, name);
                const isDirectory = (type & this.code.FileType.Directory) !== 0;
                const isSymbolicLink = (type & this.code.FileType.SymbolicLink) !== 0;
                if (isIgnored(relativePath, isDirectory, scopes)) {
                    continue;
                }

                if (isDirectory) {
                    if (isSymbolicLink || hardExcludedDirectories.has(name.toLowerCase())) {
                        continue;
                    }
                    if (directory.depth >= budgets.maxDepth) {
                        reachedLimits.add('depth');
                        continue;
                    }
                    pending.push({
                        uri: this.code.Uri.joinPath(directory.uri, name),
                        relativePath,
                        depth: directory.depth + 1,
                        ignoreScopes: scopes,
                    });
                } else if ((type & this.code.FileType.File) !== 0) {
                    const uri = this.code.Uri.joinPath(directory.uri, name);
                    files.set(relativePath, uri);
                    if (candidatePatterns.some(pattern => matchesFilePattern(name, pattern))) {
                        if (candidateRoots.size < budgets.maxProjects) {
                            candidateRoots.add(directory.relativePath);
                        } else if (!candidateRoots.has(directory.relativePath)) {
                            reachedLimits.add('projects');
                        }
                    }
                }
            }
        }

        if (pending.length > 0) {
            reachedLimits.add('entries');
        }

        return {
            workspaceFolder,
            files,
            candidateRoots: [...candidateRoots].sort(comparePaths),
            reachedLimits,
        };
    }

    private async loadIgnoreScope(
        directory: PendingDirectory,
        entries: readonly [string, vscode.FileType][],
        budgets: WorkspaceScanBudgets,
        token: vscode.CancellationToken | undefined,
        reachedLimits: Set<WorkspaceScanLimit>,
    ): Promise<readonly IgnoreScope[]> {
        const gitignore = entries.find(([name, type]) =>
            name === '.gitignore' && (type & this.code.FileType.File) !== 0);
        if (!gitignore) {
            return directory.ignoreScopes;
        }

        const uri = this.code.Uri.joinPath(directory.uri, gitignore[0]);
        const text = await readBoundedText(this.code, uri, budgets, token, reachedLimits);
        if (text === undefined) {
            return directory.ignoreScopes;
        }

        return [...directory.ignoreScopes, {
            path: directory.relativePath,
            matcher: ignore().add(text),
        }];
    }
}

async function evaluateProject(
    code: IVsCode,
    index: WorkspaceIndex,
    rootPath: string,
    rules: readonly ProjectDetectionRule[],
    budgets: WorkspaceScanBudgets,
    token: vscode.CancellationToken | undefined,
    diagnostics: WorkspaceScanDiagnostic[],
    reachedLimits: Set<WorkspaceScanLimit>,
): Promise<WorkspaceProject | undefined> {
    const rootUri = rootPath
        ? code.Uri.joinPath(index.workspaceFolder.uri, ...rootPath.split('/'))
        : index.workspaceFolder.uri;
    const context: EvaluationContext = {
        code,
        index,
        rootPath,
        rootUri,
        budgets,
        token,
        diagnostics,
        reachedLimits,
        textCache: new Map(),
        jsonCache: new Map(),
    };
    const detections: ProjectDetection[] = [];
    const outputs: ProjectOutputDirectory[] = [];

    for (const rule of rules) {
        throwIfCanceled(token);
        const evidence = await evaluateRule(rule, context);
        if (!evidence) {
            continue;
        }

        for (const emission of rule.emits) {
            if (!detections.some(detection => detection.kind === emission.kind && detection.id === emission.id)) {
                detections.push({
                    ruleId: rule.id,
                    kind: emission.kind,
                    id: emission.id,
                    confidence: emission.confidence,
                    evidence,
                });
            }
            const output = await resolveOutputDirectory(emission, rule.id, context);
            if (output && !outputs.some(candidate => candidate.path === output.path)) {
                outputs.push(output);
            }
        }
    }

    const retainedDetections = detections.filter(detection =>
        !detections.some(candidate =>
            candidate.kind === detection.kind
            && candidate.confidence !== 'low'
            && detection.confidence === 'low'));
    const retainedRuleIds = new Set(retainedDetections.map(detection => detection.ruleId));
    const retainedOutputs = outputs.filter(output => retainedRuleIds.has(output.ruleId));

    if (retainedDetections.length === 0) {
        return undefined;
    }

    return {
        workspaceFolder: index.workspaceFolder,
        rootUri,
        relativePath: rootPath || '.',
        frameworks: idsOfKind(retainedDetections, 'framework'),
        buildTools: idsOfKind(retainedDetections, 'buildTool'),
        languages: idsOfKind(retainedDetections, 'language'),
        outputDirectories: retainedOutputs,
        detections: retainedDetections,
    };
}

async function evaluateRule(
    rule: ProjectDetectionRule,
    context: EvaluationContext,
): Promise<readonly ProjectDetectionEvidence[] | undefined> {
    const allResults = await evaluatePredicates(rule.all ?? [], context);
    if (allResults.some(result => !result.matched)) {
        return undefined;
    }

    const anyResults = await evaluatePredicates(rule.any ?? [], context);
    if (anyResults.length > 0 && !anyResults.some(result => result.matched)) {
        return undefined;
    }

    const noneResults = await evaluatePredicates(rule.none ?? [], context);
    if (noneResults.some(result => result.matched)) {
        return undefined;
    }

    return [...allResults, ...anyResults]
        .filter((result): result is PredicateResult & { readonly evidence: ProjectDetectionEvidence } =>
            result.matched && result.evidence !== undefined)
        .map(result => result.evidence);
}

async function evaluatePredicates(
    predicates: readonly ProjectPredicate[],
    context: EvaluationContext,
): Promise<PredicateResult[]> {
    const results: PredicateResult[] = [];
    for (const predicate of predicates) {
        throwIfCanceled(context.token);
        results.push(await evaluatePredicate(predicate, context));
    }
    return results;
}

async function evaluatePredicate(
    predicate: ProjectPredicate,
    context: EvaluationContext,
): Promise<PredicateResult> {
    switch (predicate.type) {
        case 'file': {
            const match = findProjectFile(context, predicate.pattern);
            return {
                matched: match !== undefined,
                evidence: match ? { uri: match, description: `matches ${predicate.pattern}` } : undefined,
            };
        }
        case 'dependency': {
            const file = predicate.file ?? 'package.json';
            const uri = findProjectFile(context, file);
            const json = uri ? await readJson(context, uri) : undefined;
            const matched = isRecord(json)
                && (hasStringProperty(json.dependencies, predicate.name)
                    || hasStringProperty(json.devDependencies, predicate.name));
            return {
                matched,
                evidence: matched && uri
                    ? { uri, description: `declares dependency ${predicate.name}` }
                    : undefined,
            };
        }
        case 'json': {
            const uri = findProjectFile(context, predicate.file);
            const json = uri ? await readJson(context, uri) : undefined;
            const matched = json !== undefined && matchJsonPredicate(json, predicate);
            return {
                matched,
                evidence: matched && uri
                    ? { uri, description: `matches JSON property ${predicate.path}` }
                    : undefined,
            };
        }
        case 'text': {
            const uri = findProjectFile(context, predicate.file);
            const text = uri ? await readText(context, uri) : undefined;
            const matched = text !== undefined && new RegExp(predicate.pattern, predicate.flags).test(text);
            return {
                matched,
                evidence: matched && uri
                    ? { uri, description: `matches text pattern in ${predicate.file}` }
                    : undefined,
            };
        }
    }
}

function matchJsonPredicate(json: unknown, predicate: JsonProjectPredicate): boolean {
    const values = getJsonValues(json, predicate.path);
    switch (predicate.operator) {
        case 'exists':
            return values.length > 0;
        case 'equals':
            return values.some(value => value === predicate.value);
        case 'matches': {
            if (!predicate.pattern) {
                return false;
            }
            const regex = new RegExp(predicate.pattern, predicate.flags);
            return values.some(value => typeof value === 'string' && regex.test(value));
        }
    }
}

function getJsonValues(value: unknown, path: string): readonly unknown[] {
    let values: readonly unknown[] = [value];
    for (const segment of path.split('.')) {
        values = values.flatMap(candidate => {
            if (!isRecord(candidate)) {
                return [];
            }
            return segment === '*' ? Object.values(candidate) : [candidate[segment]];
        }).filter(candidate => candidate !== undefined);
    }
    return values;
}

async function resolveOutputDirectory(
    emission: ProjectRuleEmission,
    ruleId: string,
    context: EvaluationContext,
): Promise<ProjectOutputDirectory | undefined> {
    const output = emission.outputDirectory;
    if (!output) {
        return undefined;
    }
    if (typeof output === 'string') {
        return { path: normalizeRelativePath(output), confidence: emission.confidence, ruleId };
    }

    const configured = await resolveJsonOutput(output, context);
    if (configured) {
        return { path: normalizeRelativePath(configured), confidence: emission.confidence, ruleId };
    }
    return output.fallback
        ? { path: normalizeRelativePath(output.fallback), confidence: 'low', ruleId }
        : undefined;
}

async function resolveJsonOutput(
    output: Exclude<ProjectOutputRule, string>,
    context: EvaluationContext,
): Promise<string | undefined> {
    const uri = findProjectFile(context, output.file);
    const json = uri ? await readJson(context, uri) : undefined;
    const value = json === undefined ? undefined : getJsonValues(json, output.path)[0];
    return typeof value === 'string' ? value : undefined;
}

function findProjectFile(context: EvaluationContext, pattern: string): vscode.Uri | undefined {
    const prefix = context.rootPath ? `${context.rootPath}/` : '';
    for (const [relativePath, uri] of context.index.files) {
        if (!relativePath.startsWith(prefix)) {
            continue;
        }
        const projectRelativePath = relativePath.slice(prefix.length);
        if (!projectRelativePath.includes('/') && matchesFilePattern(projectRelativePath, pattern)) {
            return uri;
        }
    }
    return undefined;
}

async function readJson(context: EvaluationContext, uri: vscode.Uri): Promise<unknown> {
    const key = uri.toString();
    let value = context.jsonCache.get(key);
    if (!value) {
        value = (async () => {
            const text = await readText(context, uri);
            if (text === undefined) {
                return undefined;
            }
            try {
                return JSON.parse(text) as unknown;
            } catch (error) {
                if (!(error instanceof SyntaxError)) {
                    throw error;
                }
                if (!context.diagnostics.some(diagnostic => diagnostic.uri.toString() === key)) {
                    context.diagnostics.push({
                        uri,
                        code: 'invalidJson',
                        message: 'The project manifest contains invalid JSON.',
                    });
                }
                return undefined;
            }
        })();
        context.jsonCache.set(key, value);
    }
    return value;
}

async function readText(context: EvaluationContext, uri: vscode.Uri): Promise<string | undefined> {
    const key = uri.toString();
    let value = context.textCache.get(key);
    if (!value) {
        value = readBoundedText(
            context.code,
            uri,
            context.budgets,
            context.token,
            context.reachedLimits,
        );
        context.textCache.set(key, value);
    }
    return value;
}

async function readBoundedText(
    code: IVsCode,
    uri: vscode.Uri,
    budgets: WorkspaceScanBudgets,
    token: vscode.CancellationToken | undefined,
    reachedLimits: Set<WorkspaceScanLimit>,
): Promise<string | undefined> {
    throwIfCanceled(token);
    try {
        const stat = await code.workspace.fs.stat(uri);
        throwIfCanceled(token);
        if (stat.size > budgets.maxEvidenceFileBytes) {
            reachedLimits.add('evidenceFileSize');
            return undefined;
        }
        const content = await code.workspace.fs.readFile(uri);
        throwIfCanceled(token);
        if (content.byteLength > budgets.maxEvidenceFileBytes) {
            reachedLimits.add('evidenceFileSize');
            return undefined;
        }
        return new TextDecoder().decode(content);
    } catch (error) {
        if (isFileNotFound(error)) {
            return undefined;
        }
        throw error;
    }
}

function validateAndSortRules(rules: readonly ProjectDetectionRule[]): readonly ProjectDetectionRule[] {
    const ids = new Set<string>();
    for (const rule of rules) {
        if (ids.has(rule.id)) {
            throw new RangeError(`Duplicate project detection rule ID: ${rule.id}`);
        }
        ids.add(rule.id);
    }
    return [...rules].sort((left, right) =>
        (right.priority ?? 0) - (left.priority ?? 0)
        || specificity(right) - specificity(left)
        || left.id.localeCompare(right.id));
}

function validateBudgets(budgets: WorkspaceScanBudgets): void {
    for (const [name, value] of Object.entries(budgets)) {
        if (!Number.isInteger(value) || value < 1) {
            throw new RangeError(`${name} must be a positive integer`);
        }
    }
}

function specificity(rule: ProjectDetectionRule): number {
    return (rule.all?.length ?? 0) + (rule.any?.length ?? 0) + (rule.none?.length ?? 0);
}

function createCacheKey(
    folders: readonly vscode.WorkspaceFolder[],
    rules: readonly ProjectDetectionRule[],
    budgets: WorkspaceScanBudgets,
): string {
    return JSON.stringify({
        folders: folders.map(folder => folder.uri.toString()),
        rules,
        budgets,
    });
}

function isIgnored(relativePath: string, isDirectory: boolean, scopes: readonly IgnoreScope[]): boolean {
    let ignored = false;
    for (const scope of scopes) {
        const scopedPath = relativeToScope(relativePath, scope.path);
        if (scopedPath === undefined || scopedPath === '') {
            continue;
        }
        const result = scope.matcher.test(isDirectory ? `${scopedPath}/` : scopedPath);
        if (result.ignored) {
            ignored = true;
        } else if (result.unignored) {
            ignored = false;
        }
    }
    return ignored;
}

function relativeToScope(path: string, scope: string): string | undefined {
    if (!scope) {
        return path;
    }
    const prefix = `${scope}/`;
    return path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
}

function compareProjects(left: WorkspaceProject, right: WorkspaceProject): number {
    return left.workspaceFolder.index - right.workspaceFolder.index
        || comparePaths(left.relativePath, right.relativePath);
}

function isNestedStaticHtmlFallback(
    project: WorkspaceProject,
    projects: readonly WorkspaceProject[],
): boolean {
    if (project.detections.length !== 1 || project.detections[0].ruleId !== 'framework.static-html') {
        return false;
    }
    return projects.some(candidate =>
        candidate.workspaceFolder.uri.toString() === project.workspaceFolder.uri.toString()
        && candidate.relativePath !== project.relativePath
        && isAncestorPath(candidate.relativePath, project.relativePath));
}

function isAncestorPath(ancestor: string, descendant: string): boolean {
    return ancestor === '.' || descendant.startsWith(`${ancestor}/`);
}

function comparePaths(left: string, right: string): number {
    return pathDepth(left) - pathDepth(right) || left.localeCompare(right);
}

function pathDepth(path: string): number {
    return path ? path.split('/').length : 0;
}

function matchesFilePattern(file: string, pattern: string): boolean {
    return matchesGlob(file, pattern);
}

function joinPath(parent: string, child: string): string {
    return parent ? `${parent}/${child}` : child;
}

function normalizeRelativePath(path: string): string {
    const normalized = path.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/$/, '');
    return normalized || '.';
}

function idsOfKind(
    detections: readonly ProjectDetection[],
    kind: ProjectDetection['kind'],
): readonly string[] {
    return detections.filter(detection => detection.kind === kind).map(detection => detection.id);
}

function hasStringProperty(value: unknown, name: string): boolean {
    return isRecord(value) && typeof value[name] === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFileNotFound(error: unknown): error is { readonly code: 'FileNotFound' } {
    return error !== null && typeof error === 'object' && 'code' in error && error.code === 'FileNotFound';
}

function throwIfCanceled(token: vscode.CancellationToken | undefined): void {
    if (token?.isCancellationRequested) {
        throw new CancellationError();
    }
}

function uriContainsEither(left: string, right: string): boolean {
    return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}
