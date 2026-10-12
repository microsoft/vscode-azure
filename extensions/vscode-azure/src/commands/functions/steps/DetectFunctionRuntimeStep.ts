/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { dirname, ICodeContext, PromptStep } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { isAbsolute } from 'node:path';
import { LocalFunctionSettings } from '../../../functions/LocalFunctionSettings';
import type { CreateFunctionAppContext, FunctionWorkerRuntime } from '../CreateFunctionAppContext';
import { runtimeVersions } from './runtimesAndVersions';
import { PickRuntimeVersionStep } from './PickRuntimeVersionStep';

/** Seeds the runtime from the selected project's settings, leaving version selection to its subprompt. */
@injectable()
export class DetectFunctionRuntimeStep extends PromptStep<CreateFunctionAppContext> {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(LocalFunctionSettings) private readonly settings: LocalFunctionSettings,
    ) { super(); }

    public override shouldPrompt(context: Readonly<CreateFunctionAppContext>): boolean {
        return context.job === 'deploy' && !!context.iacFolder && !context.hasInfra && !context.functionWorkerRuntime;
    }

    public async prompt(context: Readonly<CreateFunctionAppContext>): Promise<Partial<CreateFunctionAppContext>> {
        const path = context.hydratedServiceProjectPath;
        const uri = path && context.iacFolder
            ? isAbsolute(path) ? this.ctx.code.Uri.file(path) : this.ctx.code.Uri.joinPath(context.iacFolder, path)
            : context.iacFolder;
        if (!uri) {
            return {};
        }
        const folder = context.hydratedServiceProjectPath && (await this.ctx.code.workspace.fs.stat(uri)).type === this.ctx.code.FileType.File
            ? dirname(uri) : uri;
        const { values } = await this.settings.read(folder);
        const runtime = values.FUNCTIONS_WORKER_RUNTIME?.trim().toLowerCase();
        return isWorkerRuntime(runtime) ? { functionWorkerRuntime: runtime } : {};
    }

    public override getSubPromptSteps(context: Readonly<CreateFunctionAppContext>): PromptStep<CreateFunctionAppContext>[] {
        return context.functionWorkerRuntime ? [new PickRuntimeVersionStep(this.ctx)] : [];
    }
}

/** Narrows a local worker runtime to a supported provisioning stack. */
export function isWorkerRuntime(runtime: unknown): runtime is FunctionWorkerRuntime {
    return typeof runtime === 'string' && Object.hasOwn(runtimeVersions, runtime);
}
