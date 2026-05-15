/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ICodeContext, PromptStep, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import type { CreateFunctionAppContext, FunctionWorkerRuntime } from '../CreateFunctionAppContext';

interface RuntimeItemData {
    readonly runtime: FunctionWorkerRuntime;
    readonly version: string;
}

interface RuntimeItem {
    readonly label: string;
    readonly description: string;
    readonly data: RuntimeItemData;
}

// TODO: more runtimes / versions or split into runtime step and version step / etc.
function getRuntimeItems(ctx: ICodeContext): RuntimeItem[] {
    return [
        { label: ctx.code.l10n.t('Node.js'), description: ctx.code.l10n.t('JavaScript / TypeScript'), data: { runtime: 'node', version: '24' } },
        { label: ctx.code.l10n.t('Python'), description: ctx.code.l10n.t('Python 3.14'), data: { runtime: 'python', version: '3.14' } },
        { label: ctx.code.l10n.t('.NET (isolated)'), description: ctx.code.l10n.t('.NET 10 isolated worker'), data: { runtime: 'dotnet-isolated', version: '10.0' } },
        { label: ctx.code.l10n.t('Java'), description: ctx.code.l10n.t('Java 25'), data: { runtime: 'java', version: '25' } },
        { label: ctx.code.l10n.t('PowerShell'), description: ctx.code.l10n.t('PowerShell 7.6'), data: { runtime: 'powershell', version: '7.6' } },
        { label: ctx.code.l10n.t('Custom'), description: ctx.code.l10n.t('Custom handler'), data: { runtime: 'custom', version: '' } },
    ];
}

/**
 * Prompts the user to pick a Function App runtime stack.
 */
export class PickRuntimeStep extends PromptStep<CreateFunctionAppContext> {
    public constructor(
        private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<CreateFunctionAppContext>): boolean {
        return !context.functionWorkerRuntime && !context.hasInfra;
    }

    public async prompt(): Promise<Partial<CreateFunctionAppContext>> {
        const picked = await showSmartQuickPick(this.ctx, getRuntimeItems(this.ctx), {
            placeHolder: this.ctx.code.l10n.t('Select a runtime stack'),
            showBack: true,
        });

        const { runtime, version } = picked.data;
        return { functionWorkerRuntime: runtime, runtimeVersion: version };
    }
}
