/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeContext, PromptStep, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { CreateFunctionAppContext, FunctionWorkerRuntime } from '../CreateFunctionAppContext';
import { PickRuntimeVersionStep } from './PickRuntimeVersionStep';

interface RuntimeItem {
    readonly label: string;
    readonly description: string;
    readonly data: FunctionWorkerRuntime;
}

function getRuntimeItems(ctx: ICodeContext): RuntimeItem[] {
    return [
        { label: ctx.code.l10n.t('Node.js'), description: ctx.code.l10n.t('JavaScript / TypeScript'), data: 'node' },
        { label: ctx.code.l10n.t('Python'), description: ctx.code.l10n.t('Python'), data: 'python' },
        { label: ctx.code.l10n.t('.NET (isolated)'), description: ctx.code.l10n.t('.NET isolated worker'), data: 'dotnet-isolated' },
        { label: ctx.code.l10n.t('Java'), description: ctx.code.l10n.t('Java'), data: 'java' },
        { label: ctx.code.l10n.t('PowerShell'), description: ctx.code.l10n.t('PowerShell'), data: 'powershell' },
    ];
}

/**
 * Prompts the user to pick a Function App runtime stack.
 *
 * Only the runtime is selected here; the version is resolved by the {@linkcode PickRuntimeVersionStep}
 * subprompt inserted immediately after this step.
 */
@injectable()
export class PickRuntimeStep extends PromptStep<CreateFunctionAppContext> {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<CreateFunctionAppContext>): boolean {
        return !context.functionWorkerRuntime
            && (!context.hasInfra || (context.job === 'deploy' && !context.hasServices));
    }

    public async prompt(): Promise<Partial<CreateFunctionAppContext>> {
        const picked = await showSmartQuickPick(this.ctx, getRuntimeItems(this.ctx), {
            placeHolder: this.ctx.code.l10n.t('Select a runtime stack'),
            showBack: true,
        });

        return { functionWorkerRuntime: picked.data };
    }

    public override getSubPromptSteps(): PromptStep<CreateFunctionAppContext>[] {
        return [new PickRuntimeVersionStep(this.ctx)];
    }
}
