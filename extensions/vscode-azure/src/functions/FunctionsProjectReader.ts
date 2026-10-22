/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFunctionsHostClientProvider } from '@microsoft/vscode-azure-azutils';
import { dirname, ExternalError, IActionExecutor, IVsCode, readRequiredJson, stringifyError, type ICaselessMapReader } from '@microsoft/vscode-azure-utils';
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
}

/** Reads local project contracts and lists functions from a ready host. */
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

    /** Lists functions from the project's ready host; without one, shows a hint to start debugging. */
    public async functions(project: FunctionsProjectNode): Promise<LocalFunctionsNode[]> {
        try {
            const config = await this.hostConfig(project.resourceUri);
            const folder = dirname(project.resourceUri);
            const { values } = await this.settings.read(folder);
            const host = this.hosts.get(folder);
            if (!host) {
                return [this.hint(project, 'host', this.code.l10n.t('Start debugging to list functions...'))];
            }
            const metadata: FunctionMetadata[] = (await this.createHost({ port: host.port }).listFunctions()).map(fn => ({
                name: fn.name, config: fn.config, isDisabled: fn.isDisabled,
            }));
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
                    if (!fn.name.trim() || /[\\/]/.test(fn.name) || names.has(fn.name)) {
                        throw new ExternalError(this.code.l10n.t('The function name is missing, invalid, or duplicated.'));
                    }
                    names.add(fn.name);
                    nodes.push(this.functionNode(project, fn, values));
                } catch (error: unknown) {
                    nodes.push(this.invalid(project, `function/${nodes.length}`, stringifyError(error), fn.name));
                    this.executor.output.error(this.code.l10n.t('[data] Could not read local function metadata.'));
                }
            }
            return nodes;
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
            label: fn.name, functionName: fn.name, project,
            ...metadata,
            isDisabled: disabled,
        };
    }

    private hint(project: FunctionsProjectNode, kind: string, label: string): LocalFunctionsNode {
        return { id: `${project.id}/hint/${kind}`, type: 'functionsHint', project, label };
    }

    private invalid(project: FunctionsProjectNode, key: string, error: string, label?: string): LocalFunctionsNode {
        return {
            id: `${project.id}/invalid/${key}`, type: 'invalidLocalFunction', project,
            label: label ?? this.code.l10n.t('Unable to list functions'), error,
        };
    }

    private async hostConfig(uri: vscode.Uri): Promise<Record<string, unknown>> {
        const config = await readRequiredJson(this.code, uri);
        if (!config || typeof config !== 'object' || Array.isArray(config)) {
            throw new ExternalError(this.code.l10n.t('host.json must contain a JSON object.'));
        }
        if ('version' in config && config.version !== '2.0') {
            throw new ExternalError(this.code.l10n.t('Use the host.json version 2.0 schema for a Functions runtime v4 project.'));
        }
        return config as Record<string, unknown>;
    }
}
