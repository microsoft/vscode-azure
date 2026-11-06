/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeContext, PromptStep } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { LocalFunctionSettings } from '../../../functions/LocalFunctionSettings';
import type { CreateFunctionAppContext, FunctionWorkerRuntime } from '../CreateFunctionAppContext';
import { PickRuntimeVersionStep } from './PickRuntimeVersionStep';

/** Reuses the local project's runtime when configuring deployment. */
@injectable()
export class HydrateFunctionsRuntimeStep extends PromptStep<CreateFunctionAppContext> {
    public constructor(
        @inject(LocalFunctionSettings) private readonly settings: LocalFunctionSettings,
        @inject(ICodeContext) private readonly ctx: ICodeContext,
    ) { super(); }

    public override shouldPrompt(context: Readonly<CreateFunctionAppContext>): boolean {
        return context.job === 'deploy' && !context.hasServices && !!context.iacFolder;
    }

    public async prompt(context: Readonly<CreateFunctionAppContext>): Promise<Partial<CreateFunctionAppContext>> {
        const runtime = (await this.settings.read(context.iacFolder!)).values.get('FUNCTIONS_WORKER_RUNTIME')?.toLowerCase(); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- required by shouldPrompt
        return {
            azdServiceName: context.azdServiceName ?? context.environmentName,
            functionWorkerRuntime: runtime && isDeploymentRuntime(runtime) ? runtime : undefined,
        };
    }

    public override getSubPromptSteps(context: Readonly<CreateFunctionAppContext>): PromptStep<CreateFunctionAppContext>[] {
        return context.functionWorkerRuntime ? [new PickRuntimeVersionStep(this.ctx)] : [];
    }
}

function isDeploymentRuntime(runtime: string): runtime is FunctionWorkerRuntime {
    return ['node', 'python', 'dotnet-isolated', 'java', 'powershell'].includes(runtime);
}
