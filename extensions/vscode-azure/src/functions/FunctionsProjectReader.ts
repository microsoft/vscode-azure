/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFunctionsHostClientProvider } from '@microsoft/vscode-azure-azutils';
import { basename, dirname, ExternalError, IActionExecutor, IVsCode, isFileNotFoundError, readText, stringifyError, type ICaselessMapReader } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { FunctionsProjectKeyPrefix, type FunctionsProjectNode, type LocalFunctionsNode, type LocalFunctionNode } from '../tree/workspace/WorkspaceNode';
import { LocalFunctionSettings } from './LocalFunctionSettings';
import { LocalFunctionsHostTracker } from './host/LocalFunctionsHostTracker';
import { parseFunctionMetadata } from './functionMetadata';

interface FunctionMetadata {
    readonly name: string;
    readonly config: unknown;
    readonly isDisabled?: boolean;
    readonly uri?: vscode.Uri;
    readonly error?: string;
}

/** Reads local project contracts without parsing language source or starting a host. */
@injectable()
export class FunctionsProjectReader {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(LocalFunctionSettings) private readonly settings: LocalFunctionSettings,
        @inject(LocalFunctionsHostTracker) private readonly hosts: LocalFunctionsHostTracker,
        @inject(IFunctionsHostClientProvider) private readonly createHost: IFunctionsHostClientProvider,
    ) { }

    /** Validates project metadata while keeping settings values out of the tree model. */
    public async project(uri: vscode.Uri, label: string): Promise<FunctionsProjectNode> {
        const project: FunctionsProjectNode = {
            id: `${FunctionsProjectKeyPrefix}${uri.toString()}`, type: 'functionsProject', label, resourceUri: uri,
        };
        try {
            await this.hostConfig(uri);
            const values = (await this.settings.read(dirname(uri))).values;
            const runtime = values.get('FUNCTIONS_WORKER_RUNTIME')?.trim().toLowerCase();
            return { ...project, runtime, initialized: !!runtime };
        } catch (error: unknown) {
            this.executor.output.error(this.code.l10n.t('[data] Could not read local Functions project metadata.'));
            return { ...project, error: stringifyError(error) };
        }
    }

    /** A ready host is authoritative; offline projects use files or bounded generated-output reads. */
    public async functions(project: FunctionsProjectNode, sourceFiles: readonly vscode.Uri[], compiled?: 'java' | 'dotnet'): Promise<LocalFunctionsNode[]> {
        try {
            const config = await this.hostConfig(project.resourceUri);
            const folder = dirname(project.resourceUri);
            const { values } = await this.settings.read(folder);
            const runtime = values.get('FUNCTIONS_WORKER_RUNTIME')?.trim().toLowerCase();
            let build = compiled;
            if (runtime) {
                switch (runtime) {
                    case 'java':
                        build = 'java';
                        break;
                    case 'dotnet-isolated':
                        build = 'dotnet';
                        break;
                    default:
                        build = undefined;
                }
            }
            const host = this.hosts.get(folder);
            let metadata: FunctionMetadata[];
            let hint: LocalFunctionsNode | undefined;
            if (host) {
                metadata = (await this.createHost({ port: host.port }).listFunctions()).map(fn => ({
                    name: fn.name, config: fn.config, isDisabled: fn.isDisabled,
                }));
            } else if (build) {
                metadata = await this.buildMetadata(folder, build);
                hint = this.hint(project, 'build', this.code.l10n.t('Run build task to update this list...'));
            } else if (sourceFiles.length) {
                metadata = [];
                for (const uri of sourceFiles) {
                    metadata.push(await this.fileMetadata(uri));
                }
            } else {
                metadata = [];
                hint = this.hint(project, 'host', this.code.l10n.t('Start debugging to update this list...'));
            }
            const allowed = config.functions;
            if (allowed !== undefined && (!Array.isArray(allowed) || !allowed.every(name => typeof name === 'string'))) {
                throw new ExternalError(this.code.l10n.t('host.json functions must be an array of function names.'));
            }
            const names = new Set<string>();
            const nodes: LocalFunctionsNode[] = [];
            for (const fn of metadata) {
                if (Array.isArray(allowed) && !allowed.includes(fn.name)) {
                    continue;
                }
                try {
                    if (fn.error) {
                        throw new ExternalError(fn.error);
                    }
                    if (!fn.name.trim() || /[\\/]/.test(fn.name) || names.has(fn.name)) {
                        throw new ExternalError(this.code.l10n.t('The function name is missing, invalid, or duplicated.'));
                    }
                    names.add(fn.name);
                    nodes.push(this.functionNode(project, fn, values));
                } catch (error: unknown) {
                    nodes.push(this.invalid(project, `function/${nodes.length}`, stringifyError(error), fn.name, fn.uri));
                    this.executor.output.error(this.code.l10n.t('[data] Could not read local function metadata.'));
                }
            }
            return hint ? [...nodes, hint] : nodes;
        } catch (error: unknown) {
            this.executor.output.error(this.code.l10n.t('[data] Could not list local functions.'));
            return [this.invalid(project, 'project', stringifyError(error))];
        }
    }

    private functionNode(project: FunctionsProjectNode, fn: FunctionMetadata, values: ICaselessMapReader<string>): LocalFunctionNode {
        const metadata = parseFunctionMetadata(this.code, fn.config);
        const setting = values.get(`AzureWebJobs.${fn.name}.Disabled`);
        const disabled = setting === undefined
            ? fn.isDisabled ?? metadata.isDisabled
            : setting.toLowerCase() === 'true' || setting === '1';
        return {
            id: `${project.id}/function/${encodeURIComponent(fn.name)}`, type: 'localFunction',
            label: fn.name, functionName: fn.name, project, resourceUri: fn.uri,
            ...metadata,
            isDisabled: disabled,
        };
    }

    private hint(project: FunctionsProjectNode, kind: string, label: string): LocalFunctionsNode {
        return { id: `${project.id}/hint/${kind}`, type: 'functionsHint', project, label };
    }

    private invalid(project: FunctionsProjectNode, key: string, error: string, label?: string, resourceUri?: vscode.Uri): LocalFunctionsNode {
        return {
            id: `${project.id}/invalid/${key}`, type: 'invalidLocalFunction', project,
            label: label ?? this.code.l10n.t('Unable to list functions'), error, resourceUri,
        };
    }

    private async hostConfig(uri: vscode.Uri): Promise<Record<string, unknown>> {
        const config = await this.json(uri);
        if (!config || typeof config !== 'object' || Array.isArray(config)) {
            throw new ExternalError(this.code.l10n.t('host.json must contain a JSON object.'));
        }
        if ('version' in config && config.version !== '2.0') {
            throw new ExternalError(this.code.l10n.t('Use the host.json version 2.0 schema for a Functions runtime v4 project.'));
        }
        return config as Record<string, unknown>;
    }

    private async json(uri: vscode.Uri): Promise<unknown> {
        const text = await readText(this.code, uri);
        if (text === undefined) {
            throw new ExternalError(this.code.l10n.t('The metadata file \'{0}\' is missing.', basename(uri)));
        }
        try {
            return JSON.parse(text) as unknown;
        } catch (error: unknown) {
            if (!(error instanceof SyntaxError)) {
                throw error;
            }
            throw new ExternalError(this.code.l10n.t('The metadata file \'{0}\' is not valid JSON.', basename(uri)));
        }
    }

    private async fileMetadata(uri: vscode.Uri): Promise<FunctionMetadata> {
        const name = basename(dirname(uri));
        try {
            return { name, config: await this.json(uri), uri };
        } catch (error: unknown) {
            return { name, config: undefined, uri, error: stringifyError(error) };
        }
    }

    private async buildMetadata(folder: vscode.Uri, runtime: 'java' | 'dotnet'): Promise<FunctionMetadata[]> {
        const root = runtime === 'java'
            ? this.code.Uri.joinPath(folder, 'target', 'azure-functions')
            : this.code.Uri.joinPath(folder, 'bin');
        const files = await this.outputFiles(root);
        return runtime === 'java' ? this.javaMetadata(files) : this.dotnetMetadata(files);
    }

    private async dotnetMetadata(files: readonly vscode.Uri[]): Promise<FunctionMetadata[]> {
        const metadata = files.filter(uri => basename(uri) === 'functions.metadata');
        const timestamps = await Promise.all(metadata.map(async uri => ({ uri, mtime: (await this.code.workspace.fs.stat(uri)).mtime })));
        timestamps.sort((left, right) => right.mtime - left.mtime || left.uri.path.localeCompare(right.uri.path));
        const selected = timestamps.at(0)?.uri;
        if (!selected) {
            return [];
        }
        const data = await this.json(selected);
        if (!Array.isArray(data)) {
            throw new ExternalError(this.code.l10n.t('functions.metadata must contain an array.'));
        }
        return data.map((item: unknown) => {
            const name = item && typeof item === 'object' && 'name' in item && typeof item.name === 'string' ? item.name : '';
            return { name, config: item, uri: selected };
        });
    }

    private async javaMetadata(files: readonly vscode.Uri[]): Promise<FunctionMetadata[]> {
        const apps = files.filter(uri => basename(uri) === 'host.json');
        if (apps.length > 1) {
            throw new ExternalError(this.code.l10n.t('Multiple Java build outputs are present. Start debugging to list the active app.'));
        }
        const app = apps.at(0);
        if (!app) {
            return [];
        }
        const metadata: FunctionMetadata[] = [];
        for (const uri of files.filter(file => basename(file) === 'function.json'
            && dirname(dirname(file)).toString() === dirname(app).toString())) {
            metadata.push(await this.fileMetadata(uri));
        }
        return metadata;
    }

    /** Generated output is excluded from the workspace index and read only under a selected project. */
    private async outputFiles(root: vscode.Uri): Promise<vscode.Uri[]> {
        const pending = [{ uri: root, depth: 0 }];
        const files: vscode.Uri[] = [];
        let visited = 0;
        for (const { uri, depth } of pending) {
            let entries: [string, vscode.FileType][];
            try {
                entries = await this.code.workspace.fs.readDirectory(uri);
            } catch (error: unknown) {
                if (isFileNotFoundError(error)) {
                    continue;
                }
                throw error;
            }
            visited += entries.length;
            if (visited > 2000) {
                throw new ExternalError(this.code.l10n.t('Build output is too large to inspect. Start debugging to list functions from the host.'));
            }
            for (const [name, type] of entries.sort(([a], [b]) => a.localeCompare(b))) {
                if ((type & this.code.FileType.SymbolicLink) !== 0) {
                    continue;
                }
                const child = this.code.Uri.joinPath(uri, name);
                if ((type & this.code.FileType.File) !== 0) {
                    files.push(child);
                } else if ((type & this.code.FileType.Directory) !== 0
                    && name !== '.azurefunctions' && name !== 'lib' && name !== 'runtimes') {
                    if (depth >= 4) {
                        throw new ExternalError(this.code.l10n.t('Build output is nested too deeply to inspect. Start debugging to list functions from the host.'));
                    }
                    pending.push({ uri: child, depth: depth + 1 });
                }
            }
        }
        return files;
    }
}
