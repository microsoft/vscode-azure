/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { dirname, ICodeContext, IOutputChannel, PromptStep } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { isAbsolute } from 'node:path';
import { LocalFunctionSettings } from '../../../functions/LocalFunctionSettings';
import type { CreateFunctionAppContext, FunctionWorkerRuntime } from '../CreateFunctionAppContext';
import { runtimeVersions } from './runtimesAndVersions';
import { PickRuntimeVersionStep } from './PickRuntimeVersionStep';

/** Best-effort runtime detection from project settings; unreadable settings leave runtime selection to the user. */
@injectable()
export class DetectFunctionRuntimeStep extends PromptStep<CreateFunctionAppContext> {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(LocalFunctionSettings) private readonly settings: LocalFunctionSettings,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
    ) { super(); }

    public override shouldPrompt(context: Readonly<CreateFunctionAppContext>): boolean {
        return context.job === 'deploy' && !!context.iacFolder && !context.hasInfra && !context.functionWorkerRuntime;
    }

    public async prompt(context: Readonly<CreateFunctionAppContext>): Promise<Partial<CreateFunctionAppContext>> {
        const path = context.hydratedServiceProjectPath;
        let uri = context.iacFolder;
        if (path && uri) {
            uri = isAbsolute(path) ? uri.with({ path: this.ctx.code.Uri.file(path).path }) : this.ctx.code.Uri.joinPath(uri, path);
        }
        if (!uri) {
            return {};
        }
        try {
            const folder = context.hydratedServiceProjectPath && ((await this.ctx.code.workspace.fs.stat(uri)).type & this.ctx.code.FileType.File) !== 0
                ? dirname(uri) : uri;
            const { values } = await this.settings.read(folder);
            const runtime = values.get('FUNCTIONS_WORKER_RUNTIME')?.trim().toLowerCase();
            return isWorkerRuntime(runtime) ? { functionWorkerRuntime: runtime } : {};
        } catch {
            this.output.warn(this.ctx.code.l10n.t('[functions] Could not detect the project runtime. Select a runtime to continue.'));
            return {};
        }
    }

    public override getSubPromptSteps(context: Readonly<CreateFunctionAppContext>): PromptStep<CreateFunctionAppContext>[] {
        return context.functionWorkerRuntime ? [new PickRuntimeVersionStep(this.ctx)] : [];
    }
}

/** Narrows a local worker runtime to a supported provisioning stack. */
export function isWorkerRuntime(runtime: unknown): runtime is FunctionWorkerRuntime {
    return typeof runtime === 'string' && Object.hasOwn(runtimeVersions, runtime);
}
