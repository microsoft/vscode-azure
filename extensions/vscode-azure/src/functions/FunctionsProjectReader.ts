/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFunctionsHostClientProvider, type HostFunction } from '@microsoft/vscode-azure-azutils';
import { dirname, ExternalError, IActionExecutor, IVsCode, readRequiredJson, stringifyError, type ICaselessMapReader } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import * as z from 'zod/mini';
import { FunctionsProjectKeyPrefix, type FunctionsProjectNode, type LocalFunctionsNode, type LocalFunctionNode } from '../tree/workspace/WorkspaceNode';
import { LocalFunctionSettings } from './LocalFunctionSettings';
import { LocalFunctionsHostTracker } from './host/LocalFunctionsHostTracker';
import { parseFunctionMetadata } from './functionMetadata';

const HostConfigSchema = z.object({
    version: z.literal('2.0'),
    functions: z.optional(z.array(z.string())),
});

const FunctionNameSchema = z.string().check(
    z.refine(name => name.trim().length > 0),
    z.refine(name => !/[\\/]/.test(name)),
);

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
    public async project(uri: vscode.Uri): Promise<FunctionsProjectNode> {
        const project: FunctionsProjectNode = {
            id: `${FunctionsProjectKeyPrefix}${uri.toString()}`, type: 'functionsProject', resourceUri: uri,
        };
        try {
            await this.hostConfig(uri);
            await this.settings.read(dirname(uri));
            return project;
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
                return [{ id: `${project.id}/hint/host`, type: 'functionsHint', project }];
            }
            const metadata = await this.createHost({ port: host.port }).listFunctions();
            const allowed = config.functions;
            const names = new Set<string>();
            const nodes: LocalFunctionsNode[] = [];
            for (const fn of metadata) {
                if (allowed && !allowed.includes(fn.name)) {
                    continue;
                }
                try {
                    if (!FunctionNameSchema.safeParse(fn.name).success || names.has(fn.name)) {
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

    private functionNode(project: FunctionsProjectNode, fn: HostFunction, values: ICaselessMapReader<string>): LocalFunctionNode {
        const metadata = parseFunctionMetadata(this.code, fn.config);
        const setting = values.get(`AzureWebJobs.${fn.name}.Disabled`);
        const disabled = setting === undefined
            ? fn.isDisabled ?? metadata.isDisabled
            : setting.toLowerCase() === 'true' || setting === '1';
        return {
            id: `${project.id}/function/${encodeURIComponent(fn.name)}`, type: 'localFunction',
            functionName: fn.name, project,
            ...metadata,
            isDisabled: disabled,
        };
    }

    private invalid(project: FunctionsProjectNode, key: string, error: string, functionName?: string): LocalFunctionsNode {
        return {
            id: `${project.id}/invalid/${key}`, type: 'invalidLocalFunction', project,
            functionName, error,
        };
    }

    private async hostConfig(uri: vscode.Uri): Promise<z.output<typeof HostConfigSchema>> {
        const config = await readRequiredJson(this.code, uri);
        const parsed = HostConfigSchema.safeParse(config);
        if (parsed.success) {
            return parsed.data;
        }
        switch (parsed.error.issues[0]?.path[0]) {
            case 'version':
                throw new ExternalError(this.code.l10n.t('Use the host.json version 2.0 schema for a Functions runtime v4 project.'));
            case 'functions':
                throw new ExternalError(this.code.l10n.t('host.json functions must be an array of function names.'));
            default:
                throw new ExternalError(this.code.l10n.t('host.json must contain a JSON object.'));
        }
    }
}
